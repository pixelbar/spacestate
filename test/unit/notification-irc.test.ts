import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { messageLines, parseLine, sendIrcMessage, type IrcConfig } from "../../src/notifications/channels/irc.js";
import { notificationsConfigSchema } from "../../src/notifications/config.js";
import { ConfiguredChannels } from "../../src/notifications/configuredChannels.js";

type Reply = (line: string) => void;
/** Return true to take over a line from the default behaviour. */
type Override = (line: string, reply: Reply, socket: Socket, state: { nick: string }) => boolean | void;

interface FakeIrc {
  port: number;
  received: string[];
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/**
 * A minimal IRC server: welcomes once it has an accepted NICK and USER and
 * capability negotiation is over, echoes JOINs, answers PINGs. An override
 * that refuses a NICK clears `state.nick`.
 */
async function fakeIrc(override: Override = () => false): Promise<FakeIrc> {
  const received: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    const state = { nick: "", capNegotiating: false, gotUser: false, welcomed: false };
    const reply: Reply = (line) => socket.write(`${line}\r\n`);
    const welcome = () => {
      if (state.welcomed || !state.nick || !state.gotUser || state.capNegotiating) return;
      state.welcomed = true;
      reply(`:irc.test 001 ${state.nick} :Welcome`);
    };
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        received.push(line);
        const [command, ...args] = line.split(" ");
        if (command === "NICK") state.nick = args[0]!;
        if (override(line, reply, socket, state)) continue;
        switch (command) {
          case "NICK":
            welcome();
            break;
          case "CAP":
            if (args[0] === "REQ") {
              state.capNegotiating = true;
              reply(`:irc.test CAP * ACK :sasl`);
            } else if (args[0] === "END") {
              state.capNegotiating = false;
              welcome();
            }
            break;
          case "AUTHENTICATE":
            if (args[0] === "PLAIN") reply("AUTHENTICATE +");
            else reply(`:irc.test 903 ${state.nick} :SASL authentication successful`);
            break;
          case "USER":
            state.gotUser = true;
            welcome();
            break;
          case "JOIN":
            for (const channel of args[0]!.split(",")) reply(`:${state.nick}!bot@host JOIN :${channel}`);
            break;
          case "PING":
            reply(`:irc.test PONG irc.test ${args[0]}`);
            break;
          case "QUIT":
            socket.end();
            break;
        }
      }
    });
    socket.on("error", () => {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: (server.address() as AddressInfo).port, received };
}

function configFor(irc: { port: number }, overrides: Partial<IrcConfig> = {}): IrcConfig {
  return {
    type: "irc",
    id: "test",
    enabled: true,
    server: "127.0.0.1",
    port: irc.port,
    tls: false,
    nick: "spacebot",
    realname: "Pixelbar space state",
    channels: ["#pixelbar"],
    join: true,
    notice: false,
    ...overrides,
  };
}

const signal = () => AbortSignal.timeout(5_000);
const withoutPingToken = (lines: string[]) => lines.map((l) => l.replace(/spacestate-[0-9a-f]+/, "<token>"));

describe("sendIrcMessage", () => {
  it("registers, joins, speaks, confirms with a PING and quits", async () => {
    const irc = await fakeIrc();
    await sendIrcMessage(configFor(irc, { channels: ["#pixelbar", "#space"] }), "Pixelbar is open.", signal());
    await expect.poll(() => irc.received.at(-1)).toMatch(/^QUIT/);
    expect(withoutPingToken(irc.received)).toEqual([
      "NICK spacebot",
      "USER spacebot 0 * :Pixelbar space state",
      "JOIN #pixelbar,#space",
      "PRIVMSG #pixelbar :Pixelbar is open.",
      "PRIVMSG #space :Pixelbar is open.",
      "PING :<token>",
      "QUIT :Pixelbar space state",
    ]);
  });

  it("answers the server's PING during registration", async () => {
    const irc = await fakeIrc((line, reply) => {
      if (line.startsWith("USER")) {
        reply("PING :check-123");
        return true;
      }
      if (line === "PONG :check-123") reply(":irc.test 001 spacebot :Welcome");
    });
    await sendIrcMessage(configFor(irc), "hi", signal());
    expect(irc.received).toContain("PONG :check-123");
  });

  it("sends the server password first", async () => {
    const irc = await fakeIrc();
    await sendIrcMessage(configFor(irc, { password: "hunter2" }), "hi", signal());
    expect(irc.received[0]).toBe("PASS :hunter2");
  });

  it("logs in with SASL PLAIN before registering", async () => {
    const irc = await fakeIrc();
    await sendIrcMessage(configFor(irc, { sasl: { account: "spacebot", password: "s3cret" } }), "hi", signal());
    expect(irc.received.slice(0, 6)).toEqual([
      "CAP REQ :sasl",
      "NICK spacebot",
      "USER spacebot 0 * :Pixelbar space state",
      "AUTHENTICATE PLAIN",
      `AUTHENTICATE ${Buffer.from("spacebot\0spacebot\0s3cret").toString("base64")}`,
      "CAP END",
    ]);
    expect(irc.received).toContain("PRIVMSG #pixelbar :hi");
  });

  it("fails for good when SASL is refused", async () => {
    const irc = await fakeIrc((line, reply) => {
      if (line.startsWith("AUTHENTICATE ") && line !== "AUTHENTICATE PLAIN") {
        reply(":irc.test 904 spacebot :SASL authentication failed");
        return true;
      }
    });
    await expect(
      sendIrcMessage(configFor(irc, { sasl: { account: "spacebot", password: "wrong" } }), "hi", signal()),
    ).rejects.toMatchObject({ retryable: false, message: "SASL: authentication failed (904)" });
  });

  it("tries another nick when its own is taken", async () => {
    const irc = await fakeIrc((line, reply, _socket, state) => {
      if (line === "NICK spacebot") {
        state.nick = "";
        reply(":irc.test 433 * spacebot :Nickname is already in use");
        return true;
      }
    });
    await sendIrcMessage(configFor(irc), "hi", signal());
    expect(irc.received).toContain("NICK spacebot1");
    expect(irc.received).toContain("PRIVMSG #pixelbar :hi");
  });

  it("fails for good when it cannot join", async () => {
    const irc = await fakeIrc((line, reply) => {
      if (line.startsWith("JOIN")) {
        reply(":irc.test 474 spacebot #pixelbar :Cannot join channel (+b)");
        return true;
      }
    });
    await expect(sendIrcMessage(configFor(irc), "hi", signal())).rejects.toMatchObject({
      retryable: false,
      message: "#pixelbar: banned from channel (474)",
    });
  });

  it("fails for good when the channel refuses the message, rather than reporting success", async () => {
    const irc = await fakeIrc((line, reply) => {
      if (line.startsWith("PRIVMSG")) {
        reply(":irc.test 404 spacebot #pixelbar :Cannot send to channel");
        return true;
      }
    });
    await expect(sendIrcMessage(configFor(irc), "hi", signal())).rejects.toMatchObject({
      retryable: false,
      message: "#pixelbar: cannot send to channel (404)",
    });
  });

  it("retries when the server hangs up, with its reason", async () => {
    const irc = await fakeIrc((line, reply, socket) => {
      if (line.startsWith("USER")) {
        reply("ERROR :Closing Link: 127.0.0.1 (Throttled: Reconnecting too fast)");
        socket.end();
        return true;
      }
    });
    await expect(sendIrcMessage(configFor(irc), "hi", signal())).rejects.toMatchObject({
      retryable: true,
      message: "server closed the connection: Closing Link: 127.0.0.1 (Throttled: Reconnecting too fast)",
    });
  });

  it("retries when it cannot connect", async () => {
    const irc = await fakeIrc();
    await new Promise((resolve) => servers.pop()!.close(resolve));
    await expect(sendIrcMessage(configFor(irc), "hi", signal())).rejects.toMatchObject({
      retryable: true,
      message: expect.stringMatching(/^connection to 127\.0\.0\.1:\d+ failed: ECONNREFUSED/),
    });
  });

  it("gives up when aborted, closing the connection", async () => {
    const irc = await fakeIrc((line) => line.startsWith("USER")); // never welcomes
    const controller = new AbortController();
    const sending = sendIrcMessage(configFor(irc), "hi", controller.signal);
    await expect.poll(() => irc.received.length).toBe(2);
    controller.abort();
    await expect(sending).rejects.toMatchObject({ message: "aborted", retryable: true });
  });

  it("can send a NOTICE without joining", async () => {
    const irc = await fakeIrc();
    await sendIrcMessage(configFor(irc, { join: false, notice: true }), "hi", signal());
    expect(irc.received.some((l) => l.startsWith("JOIN"))).toBe(false);
    expect(irc.received).toContain("NOTICE #pixelbar :hi");
  });

  it("sends each line of a multi-line message", async () => {
    const irc = await fakeIrc();
    await sendIrcMessage(configFor(irc), "Pixelbar is open.\n\nCome by!", signal());
    expect(irc.received.filter((l) => l.startsWith("PRIVMSG"))).toEqual([
      "PRIVMSG #pixelbar :Pixelbar is open.",
      "PRIVMSG #pixelbar :Come by!",
    ]);
  });
});

describe("IRC helpers", () => {
  it("parses tags, source, params and the trailing parameter", () => {
    expect(parseLine("@time=x :nick!u@h PRIVMSG #chan :hello there")).toEqual({
      source: "nick!u@h",
      command: "PRIVMSG",
      params: ["#chan", "hello there"],
    });
    expect(parseLine("PING :abc")).toEqual({ source: undefined, command: "PING", params: ["abc"] });
    expect(parseLine(":irc.test 001 bot :Welcome")).toEqual({ source: "irc.test", command: "001", params: ["bot", "Welcome"] });
  });

  it("cuts long lines without splitting a character", () => {
    const [line] = messageLines("é".repeat(400));
    expect(Buffer.byteLength(line!)).toBeLessThanOrEqual(350);
    expect(line!.endsWith("...")).toBe(true);
    expect(line).not.toContain("�");
  });
});

describe("irc channel", () => {
  const entry = { type: "irc", id: "libera", server: "irc.libera.chat", nick: "pixelbar-state", channels: ["#pixelbar"] };

  it("defaults to TLS, joining and PRIVMSG, with a longer timeout", () => {
    const config = notificationsConfigSchema.parse({ channels: [entry] });
    expect(config.channels[0]).toMatchObject({ tls: true, join: true, notice: false, realname: "Pixelbar space state" });
    const [subscriber] = new ConfiguredChannels({ get: () => config }, { space: () => "Pixelbar" }).subscribers();
    expect(subscriber!.id).toBe("irc:libera");
    expect(subscriber!.timeoutMs).toBe(30_000);
  });

  it("validates nicks and channel names", () => {
    const paths = (overrides: Record<string, unknown>) => {
      const result = notificationsConfigSchema.safeParse({ channels: [{ ...entry, ...overrides }] });
      return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
    };
    expect(paths({})).toEqual([]);
    expect(paths({ nick: "has space" })).toEqual(["channels.0.nick"]);
    expect(paths({ nick: "1starts-with-digit" })).toEqual(["channels.0.nick"]);
    expect(paths({ channels: ["pixelbar"] })).toEqual(["channels.0.channels.0"]);
    expect(paths({ channels: [] })).toEqual(["channels.0.channels"]);
  });
});
