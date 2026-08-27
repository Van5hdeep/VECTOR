# VECTOR
**Virtual Engine for Cognitive Thinking, Operations & Reasoning**

VECTOR is a personal AI assistant being developed as a local desktop-oriented application.

## Development Status
- VECTOR is currently in active development.
- The project is primarily being developed for personal use.
- The current implementation is not production-ready.
- Features and architecture are subject to change.

## Current Features
- React + Vite + TypeScript interface
- VECTOR_CORE local backend
- GroqCloud LLM integration
- Streaming text conversations
- Conversation history
- Google Calendar integration
- Google OAuth authentication for Calendar
- View upcoming Google Calendar events
- Create Google Calendar events
- Edit Google Calendar events
- Delete Google Calendar events
- LLM token usage indicator
- Context window indicator
- Draggable dashboard components
- Connected conversation window and command bar
- VECTOR dashboard/HUD interface

## Running VECTOR Locally

Install dependencies:
```bash
npm install
```

Start the local backend server (requires `.env` and Google credentials configured):
```bash
npm run server
```

Start the Vite development server:
```bash
npm run dev
```
