# Maintainers

Notes for the people who run spacestate: how its moving parts behave, how to
configure them, and how to tell what they did. If you only call the API, the
[API reference](/) is all you need.

## Where things live

The service runs on Azure Container Apps (one replica, scaling to zero when
idle) and keeps its state in Azure Table Storage. Its configuration is a
handful of documents in a blob container, each with a sample under
[`config/`](https://github.com/pixelbar/spacestate/tree/main/config) in the
repository:

| Document | What it holds |
| --- | --- |
| `spaceapi.json` | The public SpaceAPI document, minus the live fields |
| `api-keys.yaml` | API keys for `/api/v1` |
| `legacy.yaml` | Credentials for devices on the legacy endpoints |
| `notifications.yaml` | Where state changes are announced — see [Notifications](/maintainers/notifications/) |

Edit them in place, with a diff and a confirmation before anything is written:

```sh
just edit notifications    # or spaceapi | api-keys | legacy
```

The app polls these documents, so an edit takes effect within five minutes
without a redeploy. Deploying, Terraform and the release process are in the
repository's
[README](https://github.com/pixelbar/spacestate/blob/main/README.md).

## Topics

- [Notifications](/maintainers/notifications/) — announcing every state change
  to subscribers, and adding new kinds of subscriber.
  - [Webhooks](/maintainers/notifications/webhooks) — URLs clients register
    through the API, and where they are kept.
  - [Mastodon](/maintainers/notifications/mastodon) — posting statuses to an
    account.
