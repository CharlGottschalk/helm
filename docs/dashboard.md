# Dashboard and widgets

The **Command deck** is the first tab of each workspace. It shows widgets on a grid
with 6 columns. A widget is a card that shows one type of information, for example
your pending reviews or your reminders.

## The Helm window

- The **left rail** has three groups. **Navigate** contains the Command deck, the
  brain and the design system. **Tools** contains tools such as the DB explorer and
  the terminal. **Projects** contains the projects of the workspace.
- The **workspace switcher** is at the top of the left rail. You can also press
  Alt+1 to Alt+3 to change the workspace.
- The **tab bar** shows your open tabs. To close a tab, click its close button or
  middle-click it.
- The **Sessions** panel on the right shows your agent sessions and chats. See
  [Sessions and chat](sessions.md).
- The **chat dock** at the bottom sends a prompt to Claude Code or Codex.

Helm keeps the tabs and the dashboard layout of each workspace. When you change the
workspace, Helm shows the tabs and layout of that workspace again.

## Add a widget

1. On the Command deck, click **Add widget**. The **Widget library** opens.
2. Find the widget. Type in **Search widgets…**, or select a category.
3. Click **Add** on the widget card.
4. If the card shows **Configure & add**, the widget has a required setting. Set the
   values and click **Save**.

Helm shows "{widget} added to the deck". A card shows **On deck** if you can add that
widget only one time and it is already on the deck. A card with **Multi** can be on
the deck several times, each with its own settings.

## Change a widget

- **Move:** drag the header of the widget.
- **Resize:** drag the bottom-right corner. Each widget has a minimum size.
- **Configure:** click the **Widget settings** button in the header. Change the
  values and click **Save**. Only widgets that have settings show this button.
- **Remove:** click the **Remove widget** button. To get the widget back, click
  **Undo** in the message. The message stays for 5 seconds.

If a widget shows "Configure this widget to choose what it shows.", click
**Configure** and set its required values.

To go back to the default layout, click **Reset**.

## Built-in widgets

| Widget | Category | Shows |
| --- | --- | --- |
| Telemetry | Overview | Headline numbers: active projects, pending reviews, sessions and brain size |
| Workspace health | Overview | Project availability, pending reviews and captures, and warnings about interrupted operations |
| Activity | Overview | A timeline of changes in the workspace |
| Relays | Work | Open requests between linked projects. Close a relay in chat with `/tdt-relay` |
| Waiting interviews | Work | TDT interviews that wait for answers. **Open** continues one in a new tab |
| Calendar | Work | A month view of your TDT reminders, with the agenda of the selected day |
| Project spotlight | Work | The availability, path and references of one project |
| Focus timer | Work | Focus, deep-work and break countdowns |
| Notes | Knowledge | Scratchpad notes and approved knowledge |
| Review queue | Knowledge | Pending knowledge candidates. Open one, or hand it off to `/tdt-review-brain` |
| Brain radar | Knowledge | The brain, with counts for each kind of record |
| Agent runs | Agents | Live Helm agent sessions and pending knowledge captures |
| Recent sessions | Agents | The latest agent sessions. Click one to open it again in a tab |
| Stacks & skills | Utility | Installed stacks, an update check that runs when you click it, and pending skill proposals |
| Quick actions | Utility | Buttons that open sessions, the brain, core skills and settings |

Most widgets need live TDT data. In [offline mode](troubleshooting.md#offline-mode),
they show "Live TDT data · start the Helm server". Only Focus timer and Quick actions
work offline.

Plugins can add more widgets. The widget library marks them **Sandboxed**. See
[Plugins](plugins.md).

## Where Helm keeps the layout

Helm keeps the layout in your browser, not on the server. A different browser or
computer shows the default layout.
