WhatsApp Chat Viewer

Simple static web app to view exported WhatsApp .txt chat files with infinite scroll.

How to use

1. Open `index.html` in your browser (you can just double-click it or serve the folder with a static server).
2. Click "Load chat file" and choose an exported WhatsApp chat file (for example `chats/example.txt`).
3. The viewer will parse the file and render messages. Scroll up to load older messages (infinite scroll).

Query param

- You can open the app with a `chat` query parameter to auto-load a chat file. For example:

	/index.html?chat=/chats/example

	The app will attempt to fetch `/chats/example/_chat.txt` and render it if available.

Notes

- The parser is a heuristic-based client-side parser. It handles common exported formats like `[dd/mm/yyyy, hh:mm:ss AM] Sender: message` and multi-line messages.
- Deleted messages are detected by text like "This message was deleted" and shown in italic.
- This is a minimal starting point; future improvements can include tapping links, media placeholders, search, and better handling of international date formats.
