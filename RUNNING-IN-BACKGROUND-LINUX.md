# Run Slydr in the background on Linux

You can run Slydr as a `systemd` user service. It will start automatically when
you log in, run without a terminal, and restart if it exits unexpectedly.

## Prepare Slydr

From the Slydr directory, install dependencies and create the production build:

```bash
cd /path/to/slydr
npm ci
npm run build
```

## Create the systemd service

Create the user-service directory and unit file:

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/slydr.service
```

For an NVM installation, use a unit like this:

```ini
[Unit]
Description=Slydr application
After=network-online.target

[Service]
WorkingDirectory=/path/to/slydr
ExecStart=/home/your-user/.nvm/versions/node/v24.21.0/bin/npm start
Environment=NODE_ENV=production
Environment=SLYDR_NO_OPEN=1
Environment=PATH=/home/your-user/.nvm/versions/node/v24.21.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Replace these example values:

- `/path/to/slydr` with the absolute path to your Slydr checkout.
- `/home/your-user` with your Linux home directory.
- `v24.21.0` with the Node.js version installed by NVM.

The NVM-specific path can change when you install or switch Node.js versions,
and it will usually be different on another computer. Find the current npm
path with:

```bash
which npm
```

The directory containing that npm executable must be included in `PATH`, and
the same directory should be used in `ExecStart`. If Node.js was installed
system-wide instead, use the system npm path and omit the NVM-specific path.

`SLYDR_NO_OPEN=1` prevents a background service from trying to open a browser
window. Slydr remains available at the local address printed in its logs,
normally `http://127.0.0.1:4317`.

## Start the service

After saving the unit file, reload systemd and enable the service:

```bash
systemctl --user daemon-reload
systemctl --user enable --now slydr.service
```

Check whether it is running:

```bash
systemctl --user status slydr.service
```

Follow the application logs:

```bash
journalctl --user -u slydr.service -f
```

## Manage the service

```bash
systemctl --user restart slydr.service  # Restart Slydr
systemctl --user stop slydr.service     # Stop it temporarily
systemctl --user start slydr.service    # Start it again
systemctl --user disable slydr.service  # Do not start it automatically
```

After pulling changes, rebuild and restart:

```bash
npm run build
systemctl --user restart slydr.service
```

## Run after logout or reboot

Normally, a user service starts when you log in. To allow it to keep running
after logout and start during boot, enable systemd user lingering:

```bash
loginctl enable-linger "$USER"
```

Slydr listens only on the local machine, so it is not accessible from other
computers on your network.

## Troubleshooting

If the service exits with:

```text
/usr/bin/env: ‘node’: No such file or directory
```

systemd cannot find the NVM Node.js directory. Check `which npm`, update both
`ExecStart` and `Environment=PATH` in the unit file, then run:

```bash
systemctl --user daemon-reload
systemctl --user restart slydr.service
```

If the service still fails, inspect the full logs:

```bash
journalctl --user -u slydr.service --no-pager
```
