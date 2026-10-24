# Socratic Debugger

**Hints, not answers.** A debugging tutor for beginner Python students, built at the MLH x QM Hackathon.

Paste in a Python program that isn't working. Socratic Debugger runs it, shows you the real output, and then asks you guiding questions instead of handing you the fix. Each time you're still stuck, the hint gets more specific:

1. **Nudge**: one question that gets you thinking about what went wrong.
2. **Location**: points you to the part of the code where the problem is.
3. **Concept**: explains the Python idea behind the bug so you can fix it yourself.

The tutor is instructed never to write corrected code, so the student always makes the fix.

## Creators

| Name | GitHub |
| --- | --- |
| Mohammed Seddik | [@sedmoh](https://github.com/sedmoh) |
| Ibrahim Hanif | [@IbrahimCS-Create](https://github.com/IbrahimCS-Create) |

## Technologies used

**Backend**
- [Python 3](https://www.python.org/)
- [Flask](https://flask.palletsprojects.com/): web server and API routes
- [Google Gen AI SDK (`google-genai`)](https://github.com/googleapis/python-genai): calls the model through the Gemini API
- [Gemma 4](https://ai.google.dev/gemma) (`gemma-4-26b-a4b-it`): the open model that writes the hints
- [python-dotenv](https://github.com/theskumar/python-dotenv): loads the API key from `.env`

**Frontend**
- HTML, CSS and JavaScript, with no framework
- [Jost](https://fonts.google.com/specimen/Jost) from Google Fonts, used as a free stand-in for Futura when Futura isn't installed

**Testing and tooling**
- [axe-core](https://github.com/dequelabs/axe-core): automated accessibility checks
- [Claude Code](https://claude.com/claude-code): AI coding assistant used during development

## Running it locally

You need Python 3.10 or newer and a Gemini API key from [Google AI Studio](https://aistudio.google.com/).

1. Install the dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Create a file called `.env` in the project folder:

   ```
   GEMINI_API_KEY=your-key-here
   ```

3. Start the server:

   ```bash
   python app.py
   ```

   On Windows, use `py app.py` if `python` isn't recognised.

4. Open [http://localhost:5001](http://localhost:5001).

## Accessibility

The interface is designed to meet WCAG 2.2 AA:

- colour contrast that passes AA in both light and dark mode
- a light/dark toggle that remembers your choice
- full keyboard support, a skip link and visible focus
- screen-reader announcements for status messages and new hints
- support for reduced motion and Windows high-contrast mode

## Safety note

The server runs whatever Python code it receives, for up to five seconds, with no sandbox. That's fine on your own machine, but don't deploy it to the public internet as it is.

## Hackathon

- Built by a team of two during the MLH x QM Hackathon. All project work happened during the event.
- Every open-source library, API and AI tool we used is listed under [Technologies used](#technologies-used).
- We follow the [MLH Code of Conduct](https://mlh.io/code-of-conduct).

## License

[MIT](LICENSE)
