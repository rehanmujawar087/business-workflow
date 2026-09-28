# Daybook — Team Task Manager

Daybook is a lightweight daily task manager for small teams. Managers assign the day's work, employees tick it off, and anything left unfinished moves to the next day's list automatically. A built-in analytics tab shows team performance and can run a status-prediction model trained in a Jupyter notebook, right in the browser.

It is plain HTML, CSS and JavaScript with no build step and no framework. Data is kept in the browser and synced across devices through the Firebase Realtime Database REST API.

---

## Features

**For managers**
- Dashboard with today's team completion percentage, progress bar and stats (employees, tasks today, completed, carried over)
- Team list with per-employee progress and quick actions (assign, view tasks, remove)
- Assign tasks with title, details, priority, date, category and estimated hours
- Add and remove employee accounts
- Task board with filters by employee and scope (today, upcoming, all unfinished, completed, everything)
- Employee analytics tab: completion rate, on-time rate, hours spent vs. estimated, 7-day completion chart, tasks by category and priority
- Status prediction model: load a trained model file and see predicted status (e.g. *Blocked*) for every unfinished task, plus the notebook's test metrics and training-data charts

**For employees**
- Today's list with checkboxes, sorted so carried-over and high-priority tasks come first
- Personal progress bar and stats
- Log hours spent on each task
- "Coming up" list for tasks scheduled on later days

**Automatic carry-over**
Unfinished tasks from any past day are moved to today on page load, at midnight (checked every 30 seconds), and whenever the tab becomes visible again. Carried tasks are highlighted and show how many days they have been pending.

---

## Demo accounts

| Role     | Username  | Password     |
|----------|-----------|--------------|
| Manager  | `manager` | `manager123` |
| Employee | `rahul`   | `rahul123`   |
| Employee | `priya`   | `priya123`   |

The login page has one-click demo chips that fill these in. **Reset demo data** at the bottom of the manager dashboard restores the original accounts and tasks.

---

## Project structure

```
daybook/
├── index.html                 # Markup for login, manager and employee views
├── style.css                  # All styles (responsive, no framework)
├── script.js                  # App logic, Firebase sync, analytics and ML inference
├── businessworkflow.ipynb     # Notebook that trains the status-prediction model
└── notebook_export_cell.py    # Cell to paste at the end of the notebook to export the model
```

---

## Getting started

No installation or build step is needed.

1. Clone or download the project.
2. Serve the folder with any static server, for example:
   ```bash
   python -m http.server 8000
   ```
   then open `http://localhost:8000`. Opening `index.html` directly also works in most browsers.
3. Sign in with one of the demo accounts.

On first run against an empty Firebase database, the app uploads the demo data automatically.

---

## Firebase setup

Daybook talks to the Firebase Realtime Database over its REST API (no Firebase SDK). To use your own database:

1. Create a project in the [Firebase console](https://console.firebase.google.com/) and add a **Realtime Database**.
2. Copy the database URL and set it in `script.js`:
   ```js
   var FIREBASE_URL = 'https://<your-project>-default-rtdb.firebaseio.com';
   ```
3. Set the database rules. For a demo or hackathon, open rules work:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   Do not use open rules for real data — see [Security notes](#security-notes).

### Database layout

```
/managers
  /manager1        { id, name, username, password, role }
/employees
  /employee0       { id, name, username, password, role,
                     tasks: {
                       task0: { id, employeeId, title, description, priority,
                                date, originalDate, completed, completedAt,
                                createdAt, category, estimatedHours, actualHours }
                     } }
/mlModel           { json, fileName, uploadedAt }
```

Managers are numbered from `manager1`, employees from `employee0`, and tasks from `task0` within each employee. Existing node names never change.

### How sync works

- **Local first:** every change is written to `localStorage` immediately, so the app keeps working offline.
- **Upload:** only the paths that changed since the last sync are sent in a single `PATCH` request.
- **Download:** Firebase's streaming endpoint (`EventSource`) signals changes, and the app re-downloads the data. A 20-second poll acts as a fallback.
- **Status pill:** the indicator in the bottom-left corner shows *Connecting*, *Saving*, *Synced* or an error.
- Sign-in waits (up to 6 seconds) for the first download so accounts created on other devices can log in.

---

## Status prediction model

The notebook `businessworkflow.ipynb` trains a **Logistic Regression** classifier that predicts a task's `Status`. The app reproduces the same pipeline in JavaScript:

1. `SimpleImputer(strategy='mean')` for numeric features
2. `OneHotEncoder(handle_unknown='ignore')` for categorical features
3. Logistic regression scoring (binary sigmoid, multinomial softmax, or one-vs-rest)

### Features used

| Feature                 | Source in the app                                  |
|-------------------------|----------------------------------------------------|
| `Category`              | Task category                                      |
| `Assignee`              | Employee's full name                               |
| `Priority`              | High / Medium / Low                                |
| `Estimated_Hours`       | Estimated hours set by the manager                 |
| `Actual_Hours`          | Hours logged by the employee                       |
| `Planned_Duration_Days` | Days from task creation to its original due date   |
| `Actual_Duration_Days`  | Days from creation to completion (if completed)    |

### Loading the model

1. Paste `notebook_export_cell.py` at the end of `businessworkflow.ipynb` and run the whole notebook.
2. The cell downloads `daybook_model.json`.
3. In Daybook, go to **Employee analytics → Load model file** and choose that file.

The model is cached in the browser and uploaded to `/mlModel` in Firebase, so every manager device picks it up. The export includes a set of test rows with the notebook's own predictions; the app re-predicts them and shows **Matches notebook: X of Y** to confirm both sides use the same model.

### Model file format (`daybook-ml-v1`)

```json
{
  "format": "daybook-ml-v1",
  "target": "Status",
  "trainedAt": "2026-09-20T10:00:00Z",
  "model": {
    "type": "Logistic Regression",
    "classes": ["Blocked", "Completed", "In Progress", "..."],
    "numericFeatures": ["Estimated_Hours", "..."],
    "numericMeans": [4.2, "..."],
    "categoricalFeatures": ["Category", "Assignee", "Priority"],
    "categories": [["Bug Fix", "..."], ["..."], ["High", "Low", "Medium"]],
    "coef": [[0.12, "..."]],
    "intercept": [-0.3, "..."],
    "probability": "softmax"
  },
  "metrics": {
    "accuracy": 0.81,
    "precisionWeighted": 0.80,
    "f1Weighted": 0.79,
    "trainSize": 800,
    "perClass": [["Blocked", 0.7, 0.6, 0.65, 40]]
  },
  "check": [{ "features": { "Category": "Bug Fix", "...": "..." }, "predicted": "Blocked" }],
  "eda": {
    "rows": 1000,
    "missing": [["Actual_Hours", 12]],
    "category": [["Bug Fix", 130]],
    "priority": [["High", 320]],
    "status": [["Completed", 410]],
    "assignee": [["...", 90]],
    "estimatedHours": { "counts": [5, 12], "edges": [0, 1, 2] },
    "correlation": { "labels": ["Estimated_Hours", "..."], "matrix": [[1, 0.4]] }
  }
}
```

`metrics`, `check` and `eda` are optional; without them the related panels are hidden or show a dash. The `coef` row length must equal the number of numeric features plus the total number of one-hot categories.

---

## Tech stack

- HTML5, CSS3 (custom properties, grid, flexbox), vanilla JavaScript (ES5 style, no dependencies)
- Firebase Realtime Database (REST + Server-Sent Events)
- `localStorage` / `sessionStorage` with an in-memory fallback when storage is blocked
- Charts drawn with plain HTML and CSS (bars, columns, conic-gradient donut, heatmap)
- Python / scikit-learn in the notebook for training
- Fonts: Bricolage Grotesque and IBM Plex Sans (Google Fonts)

---

## Accessibility

- Semantic landmarks, labelled form fields and `role="alert"` error messages
- Progress bars expose `aria-valuenow`
- Visible focus outlines, keyboard-friendly checkboxes (focus is kept after re-render)
- Respects `prefers-reduced-motion`
- Responsive layout down to small phone screens

---

## Security notes

Daybook is built as a prototype and demo. Before using it with real data:

- **Passwords are stored in plain text** in `localStorage` and in Firebase. Move to Firebase Authentication (or another auth provider) instead of the custom username/password check.
- **Open database rules** let anyone who knows the URL read and change all data, including passwords. Lock the rules down to authenticated users and restrict employees to their own node.
- **Role checks run only in the browser**, so they can be bypassed. Enforce them with database rules or a backend.
- The Firebase URL is hard-coded in `script.js`; use your own project rather than the one in the repository.

---

## Known limitations

- Sync is last-write-wins; two people editing the same task at the same moment can overwrite each other.
- Dates use the device's local time zone, so devices in different zones may roll over at different times.
- The model file must be under 5 MB.
- The prediction model only supports the logistic regression pipeline described above.

---

## License

Add a license of your choice (for example MIT) before publishing.
