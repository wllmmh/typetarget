# Chrome Web Store listing

Copy-paste material for the Chrome Web Store Developer Dashboard, field by field. Keep it in
step with the manifest, `_locales/en/messages.json` and [PRIVACY.md](../../PRIVACY.md) when any
of them changes. To build the
package, see "Releasing" in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Store listing tab

**Name** (`extName` in `_locales/en/messages.json`; other languages have their own): TypeTarget — Speech to text anywhere

**Summary** (`extDescription` in `_locales/en/messages.json`, 98/132 characters; every other
language's is at most 125):
Transcribe browser tab audio directly into any text field, with your choice of AI model for free.

**Category:** Productivity → Tools. (Accessibility also fits, for captioning audio.)

**Language:** English. The store shows the name and summary in each of the 26 languages in
`_locales/` by itself. The description, screenshots and promo tile below are English only;
localized versions are added per language in the dashboard.

**Description:**

```text
TypeTarget listens to the audio playing in any browser tab — a video, a meeting, a lecture, a
podcast — and types what is said, live, into any text field you choose, in any tab.

Take notes from a lecture straight into your doc. Caption a meeting into a chat box. Pull a
transcript of a video into a form, an email or a note-taking app. Or type into TypeTarget's own
text box and save to your own device as a .txt file.

HOW IT WORKS
1. Right-click anywhere on the tab you want to transcribe and choose TypeTarget → Listen to
   this tab.
2. Choose where the text goes, from the same right-click menu on any page:
   • Type to this field: right-click any text box (a doc, a chat, an email, a form).
   • Type to new file: a text box over the bottom of the page you are on.
   • Type to new tab: a full-page text box in a tab of its own.
3. Transcribed text appears there as people speak, after anything already in the box, without
   touching your own edits. Choose Stop typing or Stop listening from the same menu, or switch
   fields any time.

The box you are typing into gets an outline with a listening timer and buttons to save its
text as a .txt file or stop typing. A new-file box can also be minimized or moved into its own
tab.

The toolbar popup has a Start/Stop button for listening and one for typing, plus the model
picker, the API key for each hosted model, the spoken language and live diagnostics. Turn off
"Show outline" to type without any outline or buttons on the site; the toolbar icon shows REC
instead.

CHOOSE YOUR TRANSCRIPTION MODEL
• Groq (Whisper Large v3 / v3 Turbo) — fast and accurate on any computer. Uses your own Groq
  API key.
• Gemini 3.5 Transcribe Live (Google) — Google's streaming transcription. Uses your own Gemini API key.
• Local Whisper, in your browser — Tiny, Base, Small, Medium and Large (v2, v3, v3 Turbo),
  31 MB to 1 GB, downloaded once and cached. No key, no account, and audio never leaves your
  device. Keeps up live only on fast computers; TypeTarget tells you when it is falling behind.

PRIVATE BY DESIGN
• No accounts, no servers, no analytics, no tracking.
• Audio goes only to the provider you pick, using your own key, and never to the developer.
• API keys are stored on your device only.
• Free and open source (MIT): https://github.com/wllmmh/typetarget

LANGUAGES
• Transcription: every model detects the language being spoken and types it in that language.
  The Whisper models, local and on Groq, cover Whisper's 99 languages.
• Interface: TypeTarget's menus and buttons follow your browser's language, in Arabic, Bengali,
  Chinese (Simplified and Traditional), Czech, English, Filipino, French, German, Hindi,
  Indonesian, Italian, Japanese, Korean, Marathi, Polish, Portuguese (Brazil and Portugal),
  Russian, Spanish, Telugu, Thai, Turkish, Ukrainian, Urdu and Vietnamese.
```

**Graphic assets:**

| Asset | Size | Required | Status |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Yes | `public/icons/icon128.png` |
| Screenshots | 1280×800 or 640×400 | At least 1, up to 5 | Two exist, both from before Type to new tab: `listen-to-screenshot.png` (the menu over a video) and `write-to-screenshot.png` (the menu over a new-file box). Retake both; the menu now has six items. |
| Small promo tile | 440×280 | Yes | `promo-tile.png`: icon and name. A short tagline such as "Any tab's audio, typed anywhere" could be added. |
| Marquee promo tile | 1400×560 | No | Only used if the store features the extension |

Screenshot shot list:

1. A video playing in one tab, its transcript appearing in a Google Doc in another, with the
   popup open showing "Listening to" and "Typing to".
2. The popup's model picker opened, showing the Local, Google and Groq groups and the "API key"
   action on the hosted ones.
3. The right-click TypeTarget submenu on a text box, with all six items.
4. The "Type to new file" box over a page, with the green listening badge and its buttons.
5. A provider's API key dialog, with "stored on this device only".

A screenshot of the popup in another language (Spanish or Japanese, say) shows off the
translated interface, and can go in that language's localized listing.


## Privacy practices tab

**Single purpose:**

```text
TypeTarget transcribes the audio of a browser tab the user chooses and types the transcript into a text field the user chooses.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `tabCapture` | Captures the audio of the tab the user chooses to transcribe. This is the extension's core function. |
| `activeTab` | Gives one-time access to the tab where the user opened the popup or chose a right-click menu item, so that tab can be captured or its text box picked, without broad host permissions. |
| `scripting` | Injects the text-field picker and text-insertion script into the tab the user is picking a field in, only after they act on that tab. |
| `storage` | Saves the user's settings (model, spoken language, whether to Show outline), their own API keys for hosted models, and the current source tab and field for the browser session. |
| `offscreen` | Runs audio capture and transcription in an offscreen document, because the service worker can be stopped at any time and can't hold a media stream. |
| `contextMenus` | Adds the TypeTarget right-click menu: listen to this tab, stop listening, type to this field, type to a new box on the page or a new tab, stop typing. |
| Host: `https://generativelanguage.googleapis.com/*` | Sends captured audio to Google's Gemini API for transcription, only when the user selects a Gemini model and supplies their own key. |
| Host: `https://api.groq.com/*` | Sends captured audio to Groq's API for transcription, only when the user selects a Groq model and supplies their own key. |

**Remote code:** No, I am not using remote code. All JavaScript and the WebAssembly build of
whisper.cpp ship in the package. Whisper model files downloaded from Hugging Face are model
weights (data), not executable code.

**Data usage.** The dashboard asks which data types the extension "collects", which includes
data sent to third parties. These are ticked because of the hosted models: when the user picks
any model other than Local Whisper (Groq's hosted Whisper or Gemini), audio and that
provider's API key go to the provider. Local Whisper models send nothing.

| Data type | Tick? | Why |
| --- | --- | --- |
| Website content | Yes | Tab audio is sent to Groq/Google when a hosted model is selected. |
| Personal communications | Yes | The captured tab may be a call or meeting. |
| Authentication information | Yes | The user's own Groq/Gemini API key is sent to that provider. |
| Personally identifiable information, Health, Financial and payment, Location, Web history, User activity | No | Not collected or sent. Tab titles are kept locally for the session only and never transmitted. |

Certify all three statements: data is not sold to third parties; not used or transferred for
purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL:** the public address where [PRIVACY.md](../../PRIVACY.md) is hosted.

## Before submitting

- Load the zipped build unpacked in a clean Chrome profile and run each model once.
- Make sure the repository URL in the description and the privacy policy's contact link is public.
- Re-host PRIVACY.md whenever it changes, so the hosted copy matches the submitted build.
- Check the store accepts every folder in `_locales/`. Urdu (`ur`) is a Chrome display
  language, but may be missing from the store's list of supported locales; if it is rejected,
  remove that folder.
- Check the listing shows the translated name and summary, by viewing it with the browser in
  another language.
- The listing names Groq and Google only to say which services it can use. Don't use their
  logos in the screenshots or promo tiles.
