# Twitter / X

The `twitter` channel type posts each state change to one X account through
the v2 API (`POST https://api.x.com/2/tweets`). The code is
[`src/notifications/channels/twitter.ts`](https://github.com/pixelbar/spacestate/blob/main/src/notifications/channels/twitter.ts).

## Setting it up

You need four values from the [X developer portal](https://developer.x.com/).
Log in to the portal **as the account that should post**: the access token the
portal generates belongs to the account that owns the app. X reworks the portal
often, so the names below may have moved.

1. Create a project and an app, or reuse one.
2. In the app's **User authentication settings**, set the app permissions to
   **Read and write**. The form also asks for an app type and a callback URL;
   pick the bot/automated type and any URL you control (it is not used).
3. Under **Keys and tokens**, copy the **API Key and Secret**. These are the
   app's consumer key and secret.
4. On the same page, generate an **Access Token and Secret**, and check they are
   listed as Read and Write. A token generated before step 2 stays read-only;
   regenerate it.
5. Add the channel with `just edit notifications`:

```yaml
channels:
  - type: twitter
    id: pixelbar-x             # logged as twitter:pixelbar-x
    consumerKey: "…"           # API Key
    consumerSecret: "…"        # API Key Secret
    accessToken: "…"           # Access Token
    accessTokenSecret: "…"     # Access Token Secret
```

All four are required. Requests are signed with OAuth 1.0a (HMAC-SHA1), the
flow that posts as an account from these static credentials. OAuth 2.0 would
need refresh tokens that change on every use, and the app cannot write its own
config.

## X refuses repeated posts

X rejects a post identical to a recent one (`403`, "duplicate content"). The
space opens and closes most days, so `Pixelbar is open.` would be refused from
the second day on. This channel's default messages therefore carry the time:

| State | Default message |
| --- | --- |
| open | `{space} opened at {time}.` |
| closed | `{space} closed at {time}.` |

::: warning Document-wide messages replace these
`messages` at the top of `notifications.yaml` outrank a channel type's defaults
(see [Messages](/maintainers/notifications/#messages)). If you set them, give
this channel its own `messages` with a `{time}` (or `{date}`) in each.
:::

```yaml
  - type: twitter
    id: pixelbar-x
    messages:
      open: "{space} is open! ({time})"
      closed: "{space} is closed. ({time})"
    # …credentials
```

## What each response means

| Response | Outcome |
| --- | --- |
| `201` | Posted. |
| `401` | Final: a key or token is wrong, or was regenerated in the portal. |
| `403` | Final. X's reason is logged; usually duplicate content, a read-only token, or a restricted account. |
| `429` | Retried, though X's limits reset over hours, so the retries usually run out first. |
| `5xx`, timeout, network error | Retried after 1 s, 5 s and 30 s. |

X has no idempotency key. If a response is lost after X created the post, the
retry is refused as a duplicate, so it is not posted twice. The log then shows a
failure for a post that did go out.

## When it goes quiet

Search the logs for `twitter:<id>`. `Notification delivery failed` carries X's
`detail`, for example
`HTTP 403: You are not allowed to create a Tweet with duplicate content.`

- **Duplicate content**, without an earlier timeout: the template has no time
  in it, or the space flipped back within the same minute. Check which
  `messages` apply to this channel.
- **Duplicate content right after a timeout:** the first attempt posted. No
  action needed.
- **403 about permissions:** the access token is read-only. Regenerate it after
  setting Read and write (steps 2 and 4).
- **401:** someone regenerated a key or token in the portal. Copy the new pair
  in.
- **429:** the account's tier ran out of posts for now. X's quotas change
  often; check in the portal that the tier allows a few posts a day.

## Rotating the credentials

Regenerating a key or token in the portal invalidates the old one at once, so
changes post with `401` until the new value is in. Regenerate, then run
`just edit notifications` straight away; the app picks it up within five
minutes.
