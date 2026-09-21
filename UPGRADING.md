# Upgrading

What you have to DO when moving between versions. Most releases need nothing and are not listed here — an absent version is one you can install straight over the last.

For what actually changed in each release, see [CHANGELOG.md](CHANGELOG.md).

## To 0.2.0, on macOS only

Delete the old Claude UI from Applications before installing this one.

The app's internal identifier changed, so macOS treats this build as a new app rather than a replacement, and you would otherwise end up with two.
Your sessions, pins and groups are not affected.

Linux upgrades normally, with the same `apt install` command as before.
