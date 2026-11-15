# Run Slydr in the background on macOS

You can run Slydr as a `launchd` agent, the macOS equivalent of a `systemd` user service.
It starts automatically when you log in, runs without a terminal, and is restarted if it
exits unexpectedly.

## Prepare Slydr

From the Slydr directory, install dependencies and create the production build:

```bash
cd /path/to/slydr
npm ci
npm run build
```

## Create the launchd agent

Create the agent folder and the log folder, then edit the agent file:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/slydr
nano ~/Library/LaunchAgents/com.slydr.server.plist
```

For an NVM installation, use an agent like this:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.slydr.server</string>

    <key>Program</key>
    <string>/Users/your-user/.nvm/versions/node/v24.22.2/bin/node</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/your-user/.nvm/versions/node/v24.22.2/bin/node</string>
      <string>/path/to/slydr/server/dist/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>/path/to/slydr</string>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/Users/your-user/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin</string>
      <key>SLYDR_NO_OPEN</key>
      <string>1</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>StandardOutPath</key>
    <string>/Users/your-user/Library/Logs/slydr/slydr.out</string>
    <key>StandardErrorPath</key>
    <string>/Users/your-user/Library/Logs/slydr/slydr.err</string>
  </dict>
</plist>
```

Replace these example values:

- `/path/to/slydr` with the absolute path to your Slydr checkout.
- `/Users/your-user` with your home directory.
- `v24.22.2` with the Node.js version installed by NVM. Find the current path with:

```bash
which node
```

The file name must match the `Label`, so the file above is `com.slydr.server.plist`.

How this compares with the Linux unit file:

- `Program` and `ProgramArguments` are `ExecStart`. `Program` must be an absolute path.
- `EnvironmentVariables` is `Environment=`. `launchd` starts with `PATH` set only to
  `/usr/bin:/bin:/usr/sbin:/sbin`, so the directory containing `node` must be added to
  `PATH` or the agent never starts.
- `KeepAlive` is `Restart=always`, and `ThrottleInterval` is `RestartSec` (the launchd
  default is 10 seconds).
- The agent runs `server/dist/index.js` with `node` directly instead of `npm start`, which
  avoids the extra `npm` layer and never opens a browser. `SLYDR_NO_OPEN=1` keeps that
  behaviour if you use `npm start` instead.

## Start the agent

Load it once. `launchd` also loads every plist in `~/Library/LaunchAgents` automatically
each time you log in:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.slydr.server.plist
```

Check whether it is running:

```bash
launchctl list com.slydr.server
launchctl print gui/$(id -u)/com.slydr.server
```

Follow the application logs:

```bash
tail -f ~/Library/Logs/slydr/slydr.out
```

Slydr remains available at the local address printed in its logs, normally
`http://127.0.0.1:4317`.

## Manage the agent

```bash
launchctl kickstart -k gui/$(id -u)/com.slydr.server   # Restart Slydr now
launchctl stop com.slydr.server                        # Stop it (KeepAlive restarts it in a few seconds)
launchctl bootout gui/$(id -u)/com.slydr.server        # Remove it until the next login
launchctl disable gui/$(id -u)/com.slydr.server        # Do not start it automatically
launchctl enable gui/$(id -u)/com.slydr.server         # Allow it to start again
```

After pulling changes, rebuild and restart:

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.slydr.server
```

Editing the plist does not take effect until the agent is reloaded:

```bash
launchctl bootout gui/$(id -u)/com.slydr.server
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.slydr.server.plist
```

## When the agent runs

- A Launch Agent starts when you log in and stops when you log out. macOS has no equivalent
  of systemd user lingering, so the agent does not run while nobody is logged in. A
  system-wide Launch Daemon in `/Library/LaunchDaemons` can do that, but it needs admin
  rights and changes which folder Slydr is allowed to browse, so it is not covered here.
- Slydr listens only on `127.0.0.1`, so other computers on your network cannot reach it.
- The Mac sleeping or waking does not affect the agent; it stays loaded.

## macOS privacy protection

macOS protects `Desktop`, `Documents` and `Downloads` from processes that have not been
granted access. A process started by `launchd` is not automatically allowed to read them:
Slydr running as an agent gets a permission error for any folder under those three paths,
while the same `npm start` run from Terminal works because Terminal already has access.

If your pictures live in one of those folders, grant access to the Node.js binary:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Add the binary printed by `which node` (for example
   `/Users/your-user/.nvm/versions/node/v24.22.2/bin/node`).
3. Restart the agent with `launchctl kickstart -k gui/$(id -u)/com.slydr.server`.

Otherwise keep your pictures in an unprotected folder inside your home directory, for
example `~/Pictures`.

## Troubleshooting

- **Nothing is running.** `launchctl print gui/$(id -u)/com.slydr.server` shows the agent's
  `state` and its `last exit code`. An empty log file usually means the log directory does
  not exist yet, or `Program` points at a path that no longer exists.
- **"An agent with the label com.slydr.server is already loaded."** The agent is already
  registered; use `kickstart -k` to restart it, or `bootout` first to remove it.
- **`launchctl` reports the program cannot be found.** NVM changed your Node version. Run
  `which node`, update `Program`, `ProgramArguments` and `PATH` in the plist, then reload
  the agent as shown above.
- **Port 4317 is taken.** Slydr tries the next nine ports and logs the one it chose. Set
  `PORT` in `EnvironmentVariables` to pick a specific one.
- **Two Slydr instances.** If you also run `npm start` by hand, the second one listens on a
  different port. Stop one of them.
