import { randomBytes } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { z } from "zod";
import { channelBaseSchema, defineChannelType } from "../channel.js";
import { DeliveryError } from "../types.js";

/** Registration waits on ident and hostname lookups, which some networks take their time over. */
const IRC_TIMEOUT_MS = 30_000;
/** Room for the `:nick!user@host PRIVMSG #channel :` the server prepends when relaying, within IRC's 512 bytes. */
const MAX_TEXT_BYTES = 350;
const MAX_NICK_ATTEMPTS = 3;

const schema = channelBaseSchema.extend({
  type: z.literal("irc"),
  server: z.string().min(1),
  /** Defaults to 6697 with TLS, 6667 without. */
  port: z.number().int().min(1).max(65535).optional(),
  tls: z.boolean().default(true),
  nick: z.string().regex(/^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,29}$/, "not a valid IRC nick"),
  username: z.string().regex(/^[^\s@]+$/).optional(),
  realname: z.string().min(1).default("Pixelbar space state"),
  /** Server password (PASS), for networks or bouncers that want one. */
  password: z.string().min(1).optional(),
  /** Log in to a services account with SASL PLAIN. Some networks require it from cloud addresses. */
  sasl: z.object({ account: z.string().min(1), password: z.string().min(1) }).optional(),
  channels: z.array(z.string().regex(/^[#&][^\s,\x07]+$/, "a channel name like #pixelbar")).min(1),
  /** Join before speaking. Turn off for channels that accept messages from outside (no +n) to skip the join/part noise. */
  join: z.boolean().default(true),
  /** Send a NOTICE instead of a PRIVMSG, which bots are expected to use. */
  notice: z.boolean().default(false),
});

export type IrcConfig = z.infer<typeof schema>;

interface IrcMessage {
  source?: string;
  command: string;
  params: string[];
}

export function parseLine(line: string): IrcMessage {
  let rest = line;
  if (rest.startsWith("@")) rest = rest.slice(rest.indexOf(" ") + 1); // message tags
  let source: string | undefined;
  if (rest.startsWith(":")) {
    const space = rest.indexOf(" ");
    source = rest.slice(1, space);
    rest = rest.slice(space + 1);
  }
  let trailing: string | undefined;
  const colon = rest.indexOf(" :");
  if (colon !== -1) {
    trailing = rest.slice(colon + 2);
    rest = rest.slice(0, colon);
  }
  const [command = "", ...params] = rest.split(" ").filter(Boolean);
  if (trailing !== undefined) params.push(trailing);
  return { source, command: command.toUpperCase(), params };
}

/** Cuts at a character boundary so a multi-byte character is never split. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let out = "";
  for (const char of text) {
    if (Buffer.byteLength(out + char) > maxBytes - 3) break;
    out += char;
  }
  return `${out}...`;
}

/** One IRC line per line of the message, without control characters that would end or garble it. */
export function messageLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\0\r]/g, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => truncateUtf8(line, MAX_TEXT_BYTES));
}

/** SASL PLAIN, in the 400-byte AUTHENTICATE chunks IRCv3 requires (a final "+" if the last one is full). */
function saslPlainChunks(account: string, password: string): string[] {
  const payload = Buffer.from(`${account}\0${account}\0${password}`).toString("base64");
  const chunks: string[] = payload.match(/.{1,400}/g) ?? [];
  if (chunks.length === 0 || chunks[chunks.length - 1]!.length === 400) chunks.push("+");
  return chunks;
}

const nickOf = (source: string | undefined) => source?.split("!")[0]?.toLowerCase();

/** Numerics that mean this attempt can never succeed as configured. */
const FATAL_NUMERICS: Record<string, string> = {
  "432": "the server refused the nick",
  "464": "the server refused the password",
  "465": "this client is banned from the server",
  "902": "SASL: the account is locked",
  "904": "SASL: authentication failed",
  "905": "SASL: message too long",
  "906": "SASL: authentication aborted",
  "908": "SASL: mechanism not supported",
};
/** Numerics about a channel (its name is the second parameter). */
const CHANNEL_NUMERICS: Record<string, string> = {
  "403": "no such channel",
  "404": "cannot send to channel",
  "405": "joined too many channels",
  "471": "channel is full",
  "473": "channel is invite-only",
  "474": "banned from channel",
  "475": "channel needs a key",
  "477": "channel needs a registered nick",
};

/**
 * Connects, registers (with SASL if configured), joins, says the message in
 * every channel and quits. A connection per message rather than a resident
 * bot: the app scales to zero, so a standing connection would keep dropping,
 * and changes are rare enough that the join/part is the lesser noise.
 *
 * Resolves only once the server has answered a PING sent after the
 * messages, so an error about them ("cannot send to channel") arrives first
 * and fails the delivery instead of passing silently.
 */
export function sendIrcMessage(config: IrcConfig, text: string, signal: AbortSignal): Promise<void> {
  const lines = messageLines(text);
  const port = config.port ?? (config.tls ? 6697 : 6667);
  const verb = config.notice ? "NOTICE" : "PRIVMSG";
  const pingToken = `spacestate-${randomBytes(4).toString("hex")}`;

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DeliveryError("aborted", { retryable: true }));

    let settled = false;
    let spoke = false;
    let nick = config.nick;
    let nickAttempts = 1;
    let registered = false;
    let lastError: string | undefined;
    const pendingJoins = new Set(config.channels.map((c) => c.toLowerCase()));

    const socket: Socket = config.tls
      ? connectTls({ host: config.server, port, servername: config.server })
      : connectTcp({ host: config.server, port });
    socket.setEncoding("utf8");

    const send = (line: string) => socket.write(`${line}\r\n`);
    const settle = (error?: DeliveryError) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        send("QUIT :Pixelbar space state");
        socket.end();
        resolve();
      }
    };
    const fatal = (message: string) => settle(new DeliveryError(message, { retryable: false }));
    const onAbort = () => settle(new DeliveryError("aborted", { retryable: true }));
    signal.addEventListener("abort", onAbort, { once: true });

    const speak = () => {
      if (spoke) return;
      spoke = true;
      for (const channel of config.channels) for (const line of lines) send(`${verb} ${channel} :${line}`);
      send(`PING :${pingToken}`);
    };

    const handle = ({ source, command, params }: IrcMessage) => {
      switch (command) {
        case "PING":
          send(`PONG :${params[params.length - 1] ?? ""}`);
          return;
        case "PONG":
          if (params[params.length - 1] === pingToken) settle();
          return;
        case "CAP":
          if (params[1] === "ACK" && /(^|\s)sasl(\s|$)/.test(params[2] ?? "")) send("AUTHENTICATE PLAIN");
          else if (params[1] === "NAK") fatal("SASL: the server does not offer it");
          return;
        case "AUTHENTICATE":
          if (params[0] === "+" && config.sasl) {
            for (const chunk of saslPlainChunks(config.sasl.account, config.sasl.password)) send(`AUTHENTICATE ${chunk}`);
          }
          return;
        case "903":
          send("CAP END");
          return;
        case "001":
          registered = true;
          nick = params[0] ?? nick;
          if (config.join) send(`JOIN ${config.channels.join(",")}`);
          else speak();
          return;
        case "433": // nick in use
        case "436": // nick collision
          if (registered) return;
          if (nickAttempts >= MAX_NICK_ATTEMPTS) {
            settle(new DeliveryError(`nick ${config.nick} and its alternatives are in use`, { retryable: true }));
            return;
          }
          nick = `${config.nick}${nickAttempts++}`;
          send(`NICK ${nick}`);
          return;
        case "JOIN": {
          if (nickOf(source) !== nick.toLowerCase()) return;
          for (const channel of (params[0] ?? "").split(",")) pendingJoins.delete(channel.toLowerCase());
          if (pendingJoins.size === 0) speak();
          return;
        }
        case "ERROR":
          lastError = params[params.length - 1];
          return;
      }
      if (FATAL_NUMERICS[command]) {
        fatal(`${FATAL_NUMERICS[command]} (${command})`);
      } else if (CHANNEL_NUMERICS[command]) {
        fatal(`${params[1] ?? "channel"}: ${CHANNEL_NUMERICS[command]} (${command})`);
      }
    };

    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line) handle(parseLine(line));
      }
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      settle(new DeliveryError(`connection to ${config.server}:${port} failed: ${err.code ?? err.message}`, { retryable: true }));
    });
    socket.on("close", () => {
      // A server that hangs up (throttling, a K-line) says why in ERROR first.
      settle(new DeliveryError(`server closed the connection${lastError ? `: ${lastError}` : ""}`, { retryable: true }));
    });

    if (config.sasl) send("CAP REQ :sasl");
    if (config.password) send(`PASS :${config.password}`);
    send(`NICK ${nick}`);
    send(`USER ${config.username ?? config.nick} 0 * :${config.realname}`);
  });
}

/** Says the message in one or more IRC channels. */
export const ircChannel = defineChannelType({
  type: "irc",
  schema,
  create: (config, context) => ({
    timeoutMs: IRC_TIMEOUT_MS,
    deliver: (notification, delivery) => sendIrcMessage(config, context.message(notification), delivery.signal),
  }),
});
