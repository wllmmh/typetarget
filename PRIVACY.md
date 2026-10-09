# TypeTarget Privacy Policy

Last updated: October 8, 2026

TypeTarget is a Chrome extension that transcribes the audio of a browser tab you choose and
types the text into a text field you choose. This policy explains what data it handles and
where that data goes.

**The short version:** TypeTarget has no servers, no accounts, no analytics and no tracking. The
developer never receives your audio, your transcripts, your API keys or anything else. Audio
leaves your device only when you select a Groq or Gemini model, and then it goes only to that
provider.

## What TypeTarget handles

**Tab audio.** While you are listening to a tab, TypeTarget captures that tab's audio and
transcribes it. Audio is held in memory only for as long as transcription needs it. It is
never saved to disk.

**Transcribed text.** Text is typed into the field you picked, or into the "Type to new file"
box TypeTarget adds to a page. TypeTarget does not keep a history of transcripts. If you click
Save, the text is downloaded as a `.txt` file to your computer.

**API keys.** If you use a Groq or Gemini model, you paste in your own API key. It is stored in
your browser's extension storage on this device (`chrome.storage.local`), is not synced to your
other devices, and is sent only to the provider it belongs to, to authenticate your requests.
It is never shown again after you save it, and never logged.

**Settings.** Your chosen model and chunk length are stored on this device. The tabs you
opened TypeTarget on (their titles and addresses), the tab being listened to and the field being
typed into are stored for the current browser session only, and are cleared when you close
the browser.

## Where data goes

Which transcription model you select decides where your audio goes:

| Model | Where the audio goes |
| --- | --- |
| Local Whisper (the default) | Nowhere. It is transcribed inside your browser. |
| Groq (hosted Whisper) | Each finished utterance is uploaded to Groq (`api.groq.com`) as a short audio file, using your API key. |
| Gemini | Captured audio is streamed to Google (`generativelanguage.googleapis.com`), using your API key. |

When you use Groq or Gemini, that provider's own privacy policy and terms apply to the audio
you send, under your account with them:

- Groq: <https://groq.com/privacy-policy/>
- Google Gemini API: <https://ai.google.dev/gemini-api/terms>

**Model downloads.** The first time you use a Local Whisper model, TypeTarget downloads the model file
from Hugging Face (`huggingface.co`) and caches it in your browser. This is an ordinary file
download: Hugging Face sees the request (including your IP address), but no audio or text is
sent.

TypeTarget sends nothing anywhere else. It contains no analytics, crash reporting, advertising
or third-party tracking.

## Web pages you type into

The text field you choose belongs to the website it is on, so that website can read whatever
TypeTarget types into it, just as it could read text you typed yourself. The same applies to the
"Type to new file" box, which TypeTarget adds to the page you are on. Only pick fields on sites
you trust with the transcript.

That website can also see TypeTarget's outline, timer and buttons around the field, but not
which tab you are listening to. Turning off **Show indicators on the page** in the popup removes
them; the website can still see the text arrive. Websites you don't use TypeTarget on can't tell
it is installed.

## What the developer receives

Nothing. TypeTarget has no backend. The developer does not collect, sell or share any user data,
and has no access to your audio, transcripts or API keys.

## Removing your data

Uninstalling TypeTarget deletes everything it stored: settings, API keys and cached models.
To delete just an API key, open the API Keys dialog (the key icon next to the model picker)
and click Remove key. Session data is cleared when you close the browser.

## Changes

If this policy changes, the new version will be published at the same address with a new
"Last updated" date.

## Contact

Questions about this policy: open an issue at <https://github.com/wllmmh/typetarget/issues>.
