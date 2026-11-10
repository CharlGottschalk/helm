# Knowledge editor

The record view shows one record of your TDT brain. It has two tabs: **Read** and
**Edit**. Helm does not write to TDT itself. When you save an edit, Helm hands it off
to Claude Code or Codex. That host applies the edit through TDT after you confirm
its preview.

## Open a record

Open a record from the brain graph (**Read record**), from a widget such as Notes or
Review queue, or from a link in another record.

## Read a record

The **Read** tab shows the text of the record and its properties: kind, status,
project, dates, sources, links, provenance and review history. Click a link to open
the linked record.

The header shows the kind of the record:

| Kind | Meaning |
| --- | --- |
| Approved knowledge | Knowledge that a user approved |
| Pending candidate | Knowledge that waits for review. It is not approved knowledge |
| Scratchpad note | A working note |
| Project registration | A registered project |
| Brain index | The index of the brain |

## Edit a record

What you can change depends on the kind:

| Kind | You can change |
| --- | --- |
| Approved knowledge | The text and the links. TDT protects the title, kind, sources, provenance and review history |
| Pending candidate | The text, title, kind, sources, links and project. The candidate stays pending |
| Brain index | The text |
| Scratchpad note | Nothing. TDT has no tool to edit scratchpad notes yet. Save a new note instead |
| Project registration | Nothing. Use relink, archive or remove for projects |

To edit a record:

1. Click the **Edit** tab.
2. Change the fields in **Frontmatter** and the text in **Body · Markdown**. Select
   **Live preview** to see the result.
3. Optional: click **Use links found in the body** to copy the links from the text
   into the link list.
4. Click **Hand off edit**.

The tab shows **Edit •** while you have changes that are not saved. To remove your
changes, click **Discard**. If a field is not valid, **Hand off edit** is not
available.

### What happens after the hand-off

Helm sends the edit to the host that you selected in **Hand off to** in the chat dock.
The host shows the TDT preview of the change. The change occurs only after you
confirm it in that session. See [Sessions and chat](sessions.md).

### Offline mode

In [offline mode](troubleshooting.md#offline-mode), the button is **Review changes**.
Helm shows the changes. Click **Apply edit** to change the local sample data. This
does not change your brain.

## Review a candidate

On a pending candidate, click **Review**. Helm hands off `/tdt-review-brain` with the
path of the candidate. Approve, reject or edit the candidate in that session. Helm has
no approve or reject buttons of its own.
