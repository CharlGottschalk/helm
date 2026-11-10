# Brain graph

The brain graph shows the records of your TDT brain as nodes, and the links between
them as lines. It needs TDT 0.1.12 or later.

## Open the brain graph

Do one of these steps:

- In the left rail, click **Brain**.
- On a record, click **Brain**. The graph opens and finds that record.
- In a project, chat or widget, click **Open brain**.

## Read the graph

Each node type has a colour. The legend shows the types and the number of nodes of
each type: Index, Projects, Knowledge, Candidates, Scratchpad and Tags. The index and
the projects are hubs: the layout puts the other nodes around them.

To hide a node type, click it in the legend. Click it again to show it.

The stats bar shows the number of nodes and links, the zoom level and the status. The
status is LIVE when Helm shows your brain. In offline mode, the status is SAMPLE DATA.

## Move around

- Drag the background to move the view.
- Use the mouse wheel, or **Zoom in** and **Zoom out**, to zoom.
- Click **Fit** to show the full graph.
- Drag a node to move it.

## Search

1. Type in **Search the brain…**.
2. Helm finds nodes by title or by type name. If you type 2 or more characters, Helm
   also searches the text of the records.
3. Press Enter to select the first result, or click a result in the list.

Search does not find nodes of hidden types.

## Inspect a node

Click a node to select it. The inspector shows the type, and the buttons for that
node:

- **Read record** opens the record. See [Knowledge editor](knowledge-editor.md).
- **Open** opens a project.
- **Ask Helm** starts a chat with the question "What do we know about {node}?".

The **Connections** list shows the linked nodes. Click one to go to it. To close the
inspector, click **Close** or click the background.

## If the graph does not load

- "The brain graph needs TDT 0.1.12 or newer (tdt_brain_graph).": update TDT, then
  click **Retry**.
- "Couldn't load the brain graph: …": read the cause, correct it, then click **Retry**.
