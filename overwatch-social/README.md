# Aftermatch

Aftermatch runs on the same PC as Overwatch. It reads player names from the scoreboard, then checks whether those names have a public social profile once the match is over.

It looks at the screen you are already looking at. It does not read game memory, inject into the client, or talk to anti-cheat. A matching username can belong to a different person. The check covers public Twitch, YouTube, TikTok, and X pages for that exact name. Kick, Instagram, Reddit, and a web search are links you open yourself. It does not look up real names, phone numbers, addresses, or private accounts.

## Run it

```bash
cd overwatch-social
npm install
npm start
```

Open http://127.0.0.1:8791

1. Start a match.
2. Hold Tab so the scoreboard is on screen, then click **Capture scoreboard**. You have a few seconds to switch back to the game. You can also upload a screenshot, or type a name the reader missed.
3. Click **Match over — check socials**. If this page is open on the same computer, closing Overwatch runs that check for you.

**Use sample scoreboard** loads a built-in picture so you can see the report without a match. One of the sample names is the public creator Pokimane, so the report has a real hit to compare with the made-up BattleTags.

On Windows, screen capture works through the app. On Linux, install ImageMagick (`import`) or `scrot` if capture fails, or just upload the screenshot. The server listens on `127.0.0.1` only.

Names that are exactly a hero (`Ana`, `Reinhardt`, and the rest of the roster) are ignored on the scoreboard, because that text is usually the hero rather than the player. Type the name in if it really is their BattleTag. A BattleTag with a number, such as `Ana#1234`, is kept.

## Checks

```bash
npm test
npm run typecheck
```
