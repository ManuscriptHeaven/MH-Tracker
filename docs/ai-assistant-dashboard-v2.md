# AI Assistant Dashboard V2

Implemented on 23 October 2026 as a presentation layer over the existing assistant. The existing query engine, canonical Tracker mutations, Supabase conversation persistence, permissions, project wizard, invoice renderer, and action verification remain in use.

## Interface

- Desktop: searchable command rail, voice hero, and chat/activity panel.
- Tablet: commands open in a drawer; voice and chat remain side by side.
- Mobile: stacked voice/chat, floating Commands and Speak controls, and a fixed composer measured above the app's bottom navigation.
- The command rail includes permitted monitoring/operations commands, the last ten shortcuts for the signed-in user, and searchable conversation history grouped by Today, Yesterday, and Earlier.
- Daily briefing and operator intelligence remain available in expandable workspace insights.
- Voice states: Ready, Listening, Thinking, Speaking, Awaiting Confirmation, and Error. Live transcripts appear in the hero and chat.
- Keyboard focus indicators, labelled controls, keyboard-operated tabs, drawer focus trapping/Escape dismissal, and reduced-motion styles are included.

## Voice lifecycle

The provider no longer imports or starts the background wake-word service. Old wake-word preferences cannot re-enable background capture. Existing language, voice-input, speech-output, and mute preferences continue to work. New users have click-to-speak available; microphone permission is requested only after a click.

Closing/minimizing chat, navigating away, switching conversations, hiding the tab, and unmounting stop capture. A session token prevents delayed permission responses and stale recognition callbacks from reopening the microphone or submitting a hidden command. Queued speech is cancelled on stop; late query replies cannot restart speech after the view is left.

## Actions

All business writes continue through the existing preview/confirmation engine. Only the active preview can be confirmed or cancelled; duplicate submissions are guarded synchronously. A new independent request supersedes the old preview. Confirmation parsing accepts a complete confirmation response, rather than a matching word inside a correction or question.

Task preview Edit supports title, assignee, due date, priority, and project corrections. It generates a fresh preview without executing a write. Invalid corrections preserve the previous values for review. Existing client-message tone redrafts remain supported; other action edits use a complete replacement command. The Edit form cannot act as a confirmation button.

Cancelled and failed outcomes appear in Activity alongside the existing audit trail. Typed/spoken confirmations also retain outcome metadata in saved conversations.

The existing Admin/Manager route access and stricter Admin-only financial visibility are preserved. This change does not extend assistant access to additional account roles.

## Verification

- Production TypeScript/Vite build passed.
- 14 new behavior checks passed, covering state precedence, role-based shortcuts, history grouping, draft revision, confirmation, cancellation, stale drafts, delayed microphone permission, and stale speech results.
- Existing voice/safe-action suite: 70/70 passed.
- Existing command-center, project-wizard, action-agent, reliability, operator-intelligence, daily-briefing, and client-communication suites passed. The reliability suite retains its 180 command evaluation cases.
- Browser checks in the local demo: command -> missing details -> task preview -> correction -> fresh preview -> cancel -> Activity; command search; desktop/tablet/mobile layout; mobile input clears the measured bottom navigation.

Run the new suite with `npm run test:ai-dashboard-v2`. `scripts/run-ai-tests.mjs` can also run the existing AI suites using Vite's installed compiler, without installing a new application dependency.

Real microphone/audio hardware and authenticated production Supabase round trips were not exercised. Browser interaction used the existing local demo; speech lifecycle tests used mocked browser APIs. Existing large-bundle and mixed-import build warnings remain. No deployment or database changes are included.
