# Virtual Laboratory — MongoDB Schema

Database: `virtual_lab`

## users
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `name` | string | full name |
| `email` | string | unique index |
| `username` | string | unique index |
| `passwordHash` | string | bcrypt via `password_hash()` — never plain text |
| `role` | string | `student` \| `admin` |
| `enrollment` | string | optional student/enrollment no. |
| `mustChangePassword` | bool | true for the seeded admin until changed |
| `lastLoginAt` | int (unix) | |
| `createdAt` / `updatedAt` | int (unix) | |

## practicals
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `practicalNumber` | int | as in the lab manual |
| `title` | string | |
| `shortDescription` | string | dashboard card text |
| `aim`, `objective`, `theory`, `algorithm`, `procedure` | string | content blocks (algorithm/procedure are line-separated steps) |
| `sourceCode` | string | **exact code from the lab manual — never rewritten** |
| `language` | string | e.g. `LEX (flex)`, `C`, `8085 Assembly` |
| `expectedOutput` | string | |
| `simulationData` | object | `{ cells[], initial{}, steps[], finalOutput }` — see below |
| `order` | int | display/reorder order |
| `version` | int | incremented on every edit |
| `viewCount` | int | usage statistic |
| `history` | array | last 20 snapshots `{version, snapshot, updatedBy, updatedAt}` |
| `updatedBy` | string | admin username |
| `createdAt` / `updatedAt` | int (unix) | |

### simulationData
```jsonc
{
  "cells": [ { "key": "words", "label": "words", "kind": "num" } ], // display hints
  "initial": { "words": 0, "lines": 0, "chars": 0 },                // start state
  "steps": [
    {
      "line": 7,          // 1-based line in sourceCode
      "what":  "...",     // what this line does
      "why":   "...",     // why it is needed
      "how":   "...",     // how it affects execution
      "result":"...",     // what changed
      "before": { },      // state snapshot before
      "after":  { },      // state snapshot after
      "output": "..."     // output produced by this step
    }
  ],
  "finalOutput": "Lines = 1\nWords = 3\nCharacters = 16"
}
```

## progress
| Field | Type | Notes |
|---|---|---|
| `userId` | string | |
| `practicalId` | string | unique compound index (userId, practicalId) |
| `step` | int | executed steps (simulation cursor) |
| `completed` | bool | |
| `completedAt` / `lastAccessed` / `updatedAt` | int (unix) | |

## activities
| Field | Type | Notes |
|---|---|---|
| `userId` | string \| null | |
| `role` | string | |
| `name` | string | |
| `action` | string | login, completed_practical, update_practical, … |
| `details` | object | |
| `createdAt` | int (unix) | |

---

## API surface

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | health + DB ping |
| POST | `/api/auth/register` | public | student registration |
| POST | `/api/auth/login` | public | login (username or email) |
| POST | `/api/auth/logout` | auth | logout |
| GET | `/api/auth/me` | auth | current user + CSRF |
| POST | `/api/auth/change-password` | auth | change own password |
| GET | `/api/practicals` | student | list + progress |
| GET | `/api/practicals/{id}` | student | full practical (read-only) |
| GET | `/api/progress` | student | my progress |
| POST | `/api/progress` | student | save step/completion |
| GET | `/api/admin/stats` | admin | dashboard statistics |
| GET/POST | `/api/admin/practicals` | admin | list (+search) / create |
| GET/PUT/DELETE | `/api/admin/practicals/{id}` | admin | read / edit / delete |
| PUT | `/api/admin/practicals` | admin | reorder `{ids:[…]}` |
| GET | `/api/admin/practicals/{id}/history` | admin | version history |
| POST | `/api/admin/practicals/{id}/restore` | admin | restore a version |
| GET | `/api/admin/students` | admin | list students |
| POST | `/api/admin/students/{id}/reset-password` | admin | reset a student password |
| DELETE | `/api/admin/students/{id}` | admin | remove student |
| GET | `/api/admin/activities` | admin | activity log |

All mutating requests require the `X-CSRF-Token` header. All admin routes are
enforced server-side by role — hiding the link in the UI is not the security
mechanism.


### enrollments
Official college enrollment allow-list maintained by faculty. Fields: `enrollmentNo` (unique), `studentName`, `batch`, `program`, `status` (`active`, `admitted`, `alumni`, `inactive`), timestamps, and `updatedBy`. Student registration checks this collection; the application does not hard-code academic-year enrollment series.
