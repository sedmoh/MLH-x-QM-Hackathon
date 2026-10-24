# Socratic Debugger

**Hints, not answers.** A debugging tutor for beginner Python students, built at the MLH x QM Hackathon.

Paste in a Python program that isn't working. Socratic Debugger runs it, shows you the real output, and then asks you guiding questions instead of handing you the fix. Each time you're still stuck, the hint gets more specific. It never gives you the corrected code, so you always make the fix yourself.

## The problem

When students get stuck on a bug, the easy option is to paste the code into an AI chatbot and copy the fix it gives back. The code works, but the student learns nothing about why it broke or how to find the next bug on their own.

Socratic Debugger works more like a good teaching assistant. It asks guiding questions, points you toward the problem one step at a time, and leaves the actual fix to you.

## How it works

1. **It runs your code.** When you click "Run and get a hint", your code runs with Python, with a 5 second time limit. The app captures the real output and error message, so the hints are based on what actually happened, not a guess.

2. **It gives hints in 3 levels.** Gemma 4 writes one hint at a time, and each click of "Still stuck? Show hint 2" (then hint 3) moves you one level up:
   1. **Nudge:** a general question about what your code is doing.
   2. **Location:** points to the line or operation where the problem is.
   3. **Concept:** explains the Python idea behind the bug, without saying how to fix your code.

   Every hint sees the earlier ones, so each level adds something new. If you edit your code, the hints start again from level 1.

3. **It checks every hint for leaks.** Before a hint is shown, a second Gemma call checks whether it gives away too much for its level, such as corrected code or the exact change to make. If it does, Gemma writes a new hint, up to 2 more times. If every attempt leaks, you get a safe, general hint instead.

4. **You can add a screenshot (optional).** You can attach a PNG or JPG of your error or code, and click the preview to see it full size. The "Extract code from screenshot" button copies the code out of the image into the code box, bugs included, so you can run it and edit it. If you click "Run and get a hint" with an empty code box and a screenshot attached, the code is extracted automatically. When the code box has code, hints are based on the code and its real output, not the screenshot. If the upload or the image reading fails, the app tells you and carries on with text only.

## Creators

| Name | GitHub |
| --- | --- |
| Mohammed Seddik | [@sedmoh](https://github.com/sedmoh) |
| Ibrahim Hanif | [@IbrahimCS-Create](https://github.com/IbrahimCS-Create) |

## Model

This project uses **Gemma 4** (`gemma-4-26b-a4b-it`) through the Gemini API, with the `google-genai` Python package.

- Gemma 4 license: https://ai.google.dev/gemma/apache_2
- Gemma documentation: https://ai.google.dev/gemma/docs

## Technologies used

**Backend**
- [Python 3](https://www.python.org/)
- [Flask](https://flask.palletsprojects.com/): web server and API routes
- [Google Gen AI SDK (`google-genai`)](https://github.com/googleapis/python-genai): calls the model through the Gemini API, and uploads screenshots
- [Gemma 4](https://ai.google.dev/gemma) (`gemma-4-26b-a4b-it`): the open model that writes the hints, checks them for leaks, and reads code from screenshots
- [python-dotenv](https://github.com/theskumar/python-dotenv): loads the API key from `.env`

**Frontend**
- HTML, CSS and JavaScript, with no framework
- [Jost](https://fonts.google.com/specimen/Jost) from Google Fonts, used as a free stand-in for Futura when Futura isn't installed

**Testing and tooling**
- [axe-core](https://github.com/dequelabs/axe-core): automated accessibility checks
- [Claude Code](https://claude.com/claude-code): AI coding assistant used during development
- [PyMuPDF](https://pymupdf.readthedocs.io/), [potracer](https://github.com/tatarize/potrace) and [Pillow](https://python-pillow.org/): turning the logo into SVG and icon files

## Running it locally

You need Python 3.10 or newer and a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

1. Get the code and go into the folder:

   ```bash
   git clone https://github.com/IbrahimCS-Create/socratic-debugger.git
   cd socratic-debugger
   ```

2. Create a virtual environment and install the dependencies:

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

   On Windows, use `py -m venv venv` and then `venv\Scripts\activate`.

3. Give the app your API key, in one of these two ways:

   - Set it in your terminal: `export GEMINI_API_KEY="your-key-here"` (on Windows Command Prompt: `set GEMINI_API_KEY=your-key-here`)
   - Or create a file called `.env` in the project folder containing `GEMINI_API_KEY=your-key-here`

   **Never upload `.env` to GitHub.** It is listed in `.gitignore`, but files added through GitHub's "Upload files" page skip `.gitignore`, so a key uploaded that way becomes public.

4. Start the server:

   ```bash
   python app.py
   ```

   On Windows, use `py app.py` if `python` isn't recognised.

5. Open [http://127.0.0.1:5001](http://127.0.0.1:5001).

The server prints a line for every hint it creates, including how long it took and what the leak checker decided. To stop it, press `Ctrl+C`.
## Accessibility

The interface is designed to meet WCAG 2.2 AA:

- colour contrast that passes AA in both light and dark mode
- a light/dark toggle that remembers your choice
- full keyboard support, a skip link and visible focus
- screen-reader announcements for status messages and new hints
- support for reduced motion and Windows high-contrast mode

## Logo and icons

The logo is a question mark whose dot is a beetle. Below 48 px it switches to the simplified "favicon cut", where the beetle becomes a split circle.

| File | Use |
| --- | --- |
| `static/img/logo.svg` | Full-detail mark, used in the site header |
| `static/img/logo-small.svg` | Favicon cut, for 32 px and below |
| `static/icons/favicon.svg`, `favicon.ico` | Browser tab icon |
| `static/icons/apple-touch-icon.png` | iPhone and iPad home screen |
| `static/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Installable web app, through `static/site.webmanifest` |
| `static/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` | Chrome extension, through the `"icons"` and `"action.default_icon"` fields of its `manifest.json` |

## Limitations

- **Built for local use only.** Run it on your own computer. Do not put it on the internet as it is.
- **Student code runs directly on your computer.** The code runs with Python on the same machine as the app, with a 5 second time limit. It is not isolated from the rest of your computer, so code that deletes files or reads private data would really do that. Only run code you would be happy to run yourself.
- **The leak checker can miss leaks.** It is Gemma checking Gemma's own hints, so it can be wrong. A hint can still give away too much now and then.
- **Hints depend on the model.** Gemma can misread the bug or ask an unhelpful question, especially for long or unusual programs.

## Hackathon

- Built by a team of two during the MLH x QM Hackathon. All project work happened during the event.
- Every open-source library, API and AI tool we used is listed under [Technologies used](#technologies-used).
- We follow the [MLH Code of Conduct](https://mlh.io/code-of-conduct).

## License

This project is released under the [MIT License](LICENSE).

Gemma 4 is provided by Google under its own license, linked in the Model section above.
