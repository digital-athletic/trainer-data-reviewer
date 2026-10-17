# Glossary

Terms of the coach data reviewer, with the German words the UI uses. Screens, dictionaries and docs use these terms; a new term goes here first.

## Data

| Term | German | Code | Meaning |
|---|---|---|---|
| Exercise catalog | Übungskatalog | `Exercises.json` | The list of all exercises the training plan draws from. |
| Exercise | Übung | | Catalog entry with an id, a name, levels, tags, and start and target values. |
| Display name | Anzeigename | `displayName` | Name the athletes see. Empty means the name shows. |
| System exercise | Systemübung | `999999` | Pause. The plan adds it; it cannot be deleted. |
| Skill tree | Skillbaum | `skillTrees/*.json` | All branches of one skill. Optional input. |
| Branch | Zweig | | Slot for one movement, holding an exercise per branch level. |
| Branch level | Leiterstufe | `levels` 1 to 6 | One difficulty step of a branch, pointing to an exercise id. |
| Other side | Andere Seite | | The same exercise for the opposite side. Both exercises point to each other. |
| Start value, target value | Startwert, Zielwert | `startValue`, `targetValue` | Values per training parameter, fitness level and gender. |
| Training parameter | Trainingsparameter | `repetition`, `duration`, `weight`, `height` | What a value measures. |
| Weight type | Gewichtstyp | `weightFMax`, `weightAbsolute` | Weight as a percentage of the maximum, or in fixed kilograms. |
| Fitness level | Fitnesslevel | `beginner` … `professional` | Level of the athlete a value applies to. |

## Tags

A tag is a code such as `PAIN_KNEE`: a group prefix and a value. The UI shows the name of the value and the code. The names live under `tagValue` in `js/ui/locale-de.js` and `js/ui/locale-en.js`; the groups come from `TAG_GROUPS` in `js/core/model.js`.

| Group | German | Prefix | Meaning |
|---|---|---|---|
| Skill | Skill | `SKILL_` | Building block of a session, such as warm-up, hypertrophy (Muskelaufbau) or leg axis stability (Beinachsenstabilität). |
| Region | Region | `REGION_` | Body region: upper body, lower body, full body, core. |
| Movement direction | Bewegungsrichtung | `EXERCISE_DIRECTION_` | Family of a movement, such as knee, hip, horizontal push. |
| Weight type | Gewichtstyp | `EQ_TYPE_` | Weights, bodyweight (`KG`) or other equipment. |
| Equipment | Ausrüstung | `EQ_` | Equipment the exercise needs. |
| Training place | Trainingsort | `PLACE_` | Home, gym, hall, outside. |
| Side | Seite | `SIDE_` | Both sides, one side, left, right. |
| Age group | Altersgruppe | `AGE_` | Child, adolescent, adult. |
| Gender | Geschlecht | `GENDER_` | Male, female. |
| Playing position | Spielposition | `POSITION_` | Field player or goalkeeper. |
| Pains | Beschwerden | `PAIN_` | Joint whose pains the exercise relates to. |
| Blocked for | Gesperrt bei | `BLOCK_` | Pain exclusion: an athlete with pains in this region never gets the exercise. Not a training block. `BLOCK_HIGH_BMI` has no effect in the plan today. |
| Prevention | Prävention | `PREVENTION_` | Prevention region the exercise serves. |
| Season phase | Saisonphase | `SEASON_PHASE_` | Off-season (Trainingsfrei), preparation, competition. |
| Muscle | Muskel | `MUSCLE_` | Main muscle the exercise trains. |
| Secondary muscle | Sekundärer Muskel | `MUSCLE_SECONDARY_` | Supporting muscle. Shares the muscle names. |
| Muscle involvement | Muskelbeteiligung | `MUSCLE_INVOLVEMENT_` | Complex or isolated. |
| System tag | | `PAUSE`, `PAUSE_CARDIO_*` | Tags of the rest exercises. `PAUSE` belongs to the system exercise only. |

## Session

| Term | German | Meaning |
|---|---|---|
| Change | Änderung | One edit of a field, a tag list or a value. Undo takes back the last one. |
| Export | Export | Download of the changed files and `changelog.md`. |
| Changelog | Änderungsprotokoll | `changelog.md`, in English, listing every change for the developer. |
| Work file | Arbeitsdatei | `coach-review-work-DATE.json`, all changes of a session, to continue later. |
| Backup | Sicherung | Copy of the work in this browser, per `Exercises.json`. |
