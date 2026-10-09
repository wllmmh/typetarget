# Chrome Web Store listing

Copy-paste material for the Chrome Web Store Developer Dashboard, field by field. Keep it in
step with the manifest and [PRIVACY.md](../../PRIVACY.md) when either changes. To build the
package, see "Releasing" in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Store listing tab

**Name** (from the manifest): TypeTarget — Speech to text anywhere

**Summary** (the manifest `description`, 113/132 characters):
Live-transcribe any tab's audio straight into any text field, with your choice of AI model. Free and open source.

**Category:** Productivity → Tools. (Accessibility also fits, for captioning audio.)

**Language:** English

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
2. Right-click anywhere on a page and choose TypeTarget → Type to new file, for a text box
   right there on the page. Or right-click any existing text field already on the page and
   choose TypeTarget → Type to this field.
3. Transcribed text appears there as people speak. Choose Stop typing or Stop listening from
   the same menu, or switch fields any time.

The toolbar popup has the same controls, plus the model picker, API keys and chunk length. Turn
off "Show outline" to type without any outline or buttons on the site; the
toolbar icon shows REC instead.

CHOOSE YOUR TRANSCRIPTION MODEL
• Groq (Whisper Large v3 / v3 Turbo) — fast and accurate on any computer. Uses your own Groq
  API key.
• Gemini 3.5 Transcribe Live (Google) — Google's streaming transcription. Uses your own Gemini API key.
• Local Whisper, in your browser — no key, no account, and audio never leaves your device. Keeps up
  live only on fast computers; TypeTarget tells you when it is falling behind.

PRIVATE BY DESIGN
• No accounts, no servers, no analytics, no tracking.
• Audio goes only to the provider you pick, using your own key, and never to the developer.
• API keys are stored on your device only.
• Free and open source (MIT): https://github.com/wllmmh/typetarget

Gemini and Groq's Whisper transcribe dozens of languages. The Local Whisper models in the list are
English-only. TypeTarget's own interface is in English.
```

**Graphic assets** (none exist yet):

| Asset | Size | Required | Notes |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Yes | `public/icons/icon128.png` |
| Screenshots | 1280×800 or 640×400 | At least 1, up to 5 | See shot list below |
| Small promo tile | 440×280 | Yes | Icon, name and a short tagline such as "Any tab's audio, typed anywhere" |
| Marquee promo tile | 1400×560 | No | Only used if the store features the extension |

Screenshot shot list:

1. A video playing in one tab, its transcript appearing in a Google Doc in another, with the
   popup open showing "Listening to" and "Typing to".
2. The popup's model picker opened, showing the Local, Google and Groq groups.
3. The right-click TypeTarget submenu on a text box.
4. The "Type to new file" box over a page, with the green listening badge and Save button.
5. The API Keys dialog, with "Stored on this device only".

Avoid real people's private meetings or messages in screenshots.

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
| `storage` | Saves the user's settings (model, chunk length, whether to Show outline), their own API keys for hosted models, and the current source tab and field for the browser session. |
| `offscreen` | Runs audio capture and transcription in an offscreen document, because the service worker can be stopped at any time and can't hold a media stream. |
| `contextMenus` | Adds the TypeTarget right-click menu: listen to this tab, type to this field, type to a new box, stop typing. |
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
- The listing names Groq and Google only to say which services it can use. Don't use their
  logos in the screenshots or promo tiles.
