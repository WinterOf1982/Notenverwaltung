import { STORES, alleLaden, speichern } from './db.js';

const SOLEI_KRITERIEN = [
  'zeitmanagement',
  'material',
  'arbeitsergebnisse',
  'sozialkompetenz',
  'muendlicheBeteiligung'
];

let root;
let daten;
let busy = false;

const $ = (selector, basis = root) => basis.querySelector(selector);

function el(tag, text, klasse) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (klasse) node.className = klasse;
  return node;
}

function addOption(select, value, text) {
  const option = el('option', text);
  option.value = value;
  select.append(option);
}

function label(text, control) {
  const node = el('label', text);
  node.append(control);
  return node;
}

function field(name, type, value = '', required = true) {
  const node = document.createElement('input');
  node.name = name;
  node.type = type;
  node.value = value ?? '';
  node.required = required;
  return node;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function showNumber(value) {
  return Number(value).toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1,
    maximumFractionDigits: 1
  });
}

function noteFromPoints(points) {
  const bounded = Math.max(0, Math.min(15, points));
  return round1(1 + (15 - bounded) / 3);
}

function examGrade(points, maximum) {
  if (!Number.isFinite(points) || !Number.isFinite(maximum) || maximum <= 0) {
    return null;
  }

  const percent = Math.floor(Math.max(0, Math.min(100, points / maximum * 100)));
  const grade = percent >= 92 ? 1
    : percent >= 81 ? 2
      : percent >= 69 ? 3
        : percent >= 50 ? 4
          : percent >= 30 ? 5
            : 6;

  return { percent, grade };
}

function record(typ, filters) {
  return daten.leistungen.find((item) =>
    item.typ === typ
    && Object.entries(filters).every(([key, value]) => item[key] === value)
  );
}

async function loadData() {
  const [courses, classes, students, records] = await Promise.all([
    alleLaden(STORES.KURSE),
    alleLaden(STORES.KLASSEN),
    alleLaden(STORES.SCHUELER),
    alleLaden(STORES.LEISTUNGEN)
  ]);

  daten = { courses, classes, students, leistungen: records };
}

function activeCourse() {
  const id = Number($('[data-course]').value);
  return daten.courses.find((course) => course.id === id) ?? null;
}

function studentsIn(course) {
  return daten.students
    .filter((student) => student.klasseId === course.klasseId)
    .sort((a, b) =>
      a.nachname.localeCompare(b.nachname, 'de')
      || a.vorname.localeCompare(b.vorname, 'de'));
}

function className(course) {
  return daten.classes.find((item) => item.id === course.klasseId)?.name ?? '';
}

function settingsFor(course) {
  return course.einstellungen?.notenGewichtung ?? { solei: 50, klausuren: 50 };
}

function examsFor(course) {
  return daten.leistungen
    .filter((item) => item.typ === 'klausur-definition' && item.kursId === course.id)
    .sort((a, b) => String(a.datum ?? '').localeCompare(String(b.datum ?? '')));
}

function gradeForExam(course, exam, student) {
  return record('klausur-note', {
    kursId: course.id,
    pruefungId: exam.pruefungId,
    personId: student.id
  });
}

function studentsAverage(course) {
  return studentsIn(course);
}

function semesterQuarter(course, halfIndex, date) {
  const half = course.halbjahre?.[halfIndex];
  if (!half?.start || !half?.ende || date < half.start || date > half.ende) return null;

  const start = new Date(`${half.start}T00:00:00Z`);
  const end = new Date(`${half.ende}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000) + 1;
  const middle = new Date(start);
  middle.setUTCDate(middle.getUTCDate() + Math.floor(days / 2));
  const boundary = middle.toISOString().slice(0, 10);

  return date < boundary ? `H${halfIndex + 1}Q1` : `H${halfIndex + 1}Q2`;
}

function averageCriterion(course, student, criterion, halfIndex) {
  const half = course.halbjahre?.[halfIndex];
  if (!half) return null;

  const entries = daten.leistungen.filter((item) =>
    item.typ === 'solei'
    && item.kursId === course.id
    && item.personId === student.id
    && item.kriterium === criterion
    && item.datum >= half.start
    && item.datum <= half.ende
  );

  const values = entries.map((item) => Number(item.punkte));
  const upload = record('solei-upload-zaehler', {
    kursId: course.id,
    personId: student.id,
    halbjahr: `H${halfIndex + 1}`
  });

  const uploadCriterion = course.einstellungen?.soleiUploadKriterium;
  if (upload && uploadCriterion === criterion) {
    const maxima = course.einstellungen?.soleiMaxima ?? {};
    const q1 = Number(maxima[`H${halfIndex + 1}Q1`]?.[criterion] ?? 3);
    const q2 = Number(maxima[`H${halfIndex + 1}Q2`]?.[criterion] ?? 3);
    const maxAverage = (q1 + q2) / 2;
    const uploaded = Number(upload.hochgeladen) || 0;
    const forgotten = Number(upload.vergessen) || 0;

    values.push(...Array(uploaded).fill(maxAverage));
    values.push(...Array(forgotten).fill(0));
  }

  if (!values.length) return null;
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function calculatedSolei(course, student, halfIndex) {
  const criteria = SOLEI_KRITERIEN.map((criterion) =>
    averageCriterion(course, student, criterion, halfIndex));

  if (criteria.some((value) => value === null)) return null;

  const points = criteria.reduce((sum, value) => sum + value, 0);
  const baseGrade = noteFromPoints(points);
  const additional = record('solei-halbjahresnote', {
    kursId: course.id,
    personId: student.id,
    halbjahr: `H${halfIndex + 1}`
  })?.zusatznote;

  return additional === null || additional === undefined
    ? baseGrade
    : round1((baseGrade + Number(additional)) / 2);
}

function examAverage(course, student, halfIndex = null) {
  const exams = examsFor(course).filter((exam) => {
    if (halfIndex === null) return true;
    const half = course.halbjahre?.[halfIndex];
    return half && exam.datum >= half.start && exam.datum <= half.ende;
  });

  const grades = exams
    .map((exam) => {
      const entry = gradeForExam(course, exam, student);
      return entry ? examGrade(Number(entry.punkte), Number(exam.maxPunkte))?.grade : null;
    })
    .filter((grade) => grade !== null && grade !== undefined);

  if (!grades.length) return null;
  return round1(grades.reduce((sum, grade) => sum + grade, 0) / grades.length);
}

function mean(values) {
  const available = values.filter((value) => value !== null && Number.isFinite(value));
  if (!available.length) return null;
  return round1(available.reduce((sum, value) => sum + value, 0) / available.length);
}

function annualSolei(course, student) {
  return mean([
    calculatedSolei(course, student, 0),
    calculatedSolei(course, student, 1)
  ]);
}

function weightedGrade(course, student, halfIndex = null) {
  const solei = halfIndex === null
    ? annualSolei(course, student)
    : calculatedSolei(course, student, halfIndex);
  const exams = examAverage(course, student, halfIndex);
  const weights = settingsFor(course);

  const parts = [];
  if (solei !== null) parts.push([solei, Number(weights.solei)]);
  if (exams !== null) parts.push([exams, Number(weights.klausuren)]);

  const valid = parts.filter(([, weight]) => Number.isFinite(weight) && weight > 0);
  const totalWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;

  return round1(valid.reduce((sum, [grade, weight]) =>
    sum + grade * weight, 0) / totalWeight);
}

function manualGrade(course, student) {
  return record('zeugnisnote', {
    kursId: course.id,
    personId: student.id
  })?.note ?? null;
}

function tendency(course, student) {
  const first = calculatedSolei(course, student, 0);
  const second = calculatedSolei(course, student, 1);
  if (first === null || second === null) return '—';
  if (second < first) return '↑';
  if (second > first) return '↓';
  return '→';
}

function status(text, error = false) {
  const node = $('[data-grade-status]');
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('meldung--fehler', error);
}

/* ------------------------------------------------------------------ */
/* Oberflächen                                                         */
/* ------------------------------------------------------------------ */

export async function initialisiereNotenverwaltung() {
  if (document.getElementById('notenverwaltung')) return;

  root = el('section', undefined, 'karte');
  root.id = 'notenverwaltung';
  root.append(el('h2', 'Notenverwaltung'));

  const message = el('p', undefined, 'meldung');
  message.dataset.gradeStatus = '';
  message.hidden = true;
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  root.append(message);

  const courseSelect = document.createElement('select');
  courseSelect.dataset.course = '';
  courseSelect.setAttribute('aria-label', 'Kurs auswählen');

  const controls = el('div', undefined, 'noten-kopf formular');
  controls.append(label('Kurs', courseSelect));
  root.append(controls);

  const content = el('div');
  content.dataset.gradeContent = '';
  root.append(content);
  document.querySelector('main').append(root);

  courseSelect.addEventListener('change', async () => {
    await loadData();
    draw();
  });
  root.addEventListener('submit', handleSubmit);
  root.addEventListener('click', handleClick);

  await loadData();
  fillCourses();
  draw();
}

function fillCourses() {
  const select = $('[data-course]');
  const oldValue = select.value;
  select.replaceChildren();
  addOption(select, '', 'Kurs auswählen');

  for (const course of daten.courses) {
    const klass = className(course);
    if (klass && course.halbjahre?.length) {
      addOption(select, course.id, `${klass} · ${course.fach ?? course.name}`);
    }
  }

  if ([...select.options].some((option) => option.value === oldValue && oldValue)) {
    select.value = oldValue;
  } else if (select.options.length > 1) {
    select.selectedIndex = 1;
  }
}

function draw() {
  const content = $('[data-grade-content]');
  content.replaceChildren();
  const course = activeCourse();

  if (!course) {
    content.append(el('p', 'Wähle einen eingerichteten Kurs aus.'));
    return;
  }

  content.append(
    buildWeightSettings(course),
    buildExamCreation(course),
    buildExamList(course),
    buildOverview(course),
    buildReportSelector(course)
  );
}

function buildWeightSettings(course) {
  const details = document.createElement('details');
  details.append(el('summary', 'Gewichtung der Zeugnisnote'));
  const weights = settingsFor(course);
  const form = document.createElement('form');
  form.className = 'formular';
  form.dataset.weights = '';

  const solei = field('solei', 'number', weights.solei);
  solei.min = '0'; solei.max = '100'; solei.step = '1';
  const exams = field('klausuren', 'number', weights.klausuren);
  exams.min = '0'; exams.max = '100'; exams.step = '1';

  form.append(
    label('SoLei-Gewichtung in Prozent', solei),
    label('Klausuren-Gewichtung in Prozent', exams),
    el('p', 'Die Gewichte müssen zusammen 100 % ergeben. Fehlt eine Note, wird deren Gewicht herausgerechnet.')
  );
  const button = el('button', 'Gewichtung speichern', 'btn btn--sekundaer');
  button.type = 'submit';
  form.append(button);
  details.append(form);
  return details;
}

function buildExamCreation(course) {
  const details = document.createElement('details');
  details.append(el('summary', 'Klausur anlegen'));

  const form = document.createElement('form');
  form.className = 'formular';
  form.dataset.newExam = '';

  const title = field('titel', 'text');
  title.maxLength = 100;
  const date = field('datum', 'date');
  const max = field('maxPunkte', 'number');
  max.min = '0.1';
  max.step = '0.1';

  form.append(
    label('Bezeichnung', title),
    label('Datum', date),
    label('Maximalpunktzahl', max)
  );
  const button = el('button', 'Klausur speichern', 'btn');
  button.type = 'submit';
  form.append(button);
  details.append(form);
  return details;
}

function buildExamList(course) {
  const details = document.createElement('details');
  details.append(el('summary', 'Klausuren und Schülerergebnisse'));
  const exams = examsFor(course);

  if (!exams.length) {
    details.append(el('p', 'Für diesen Kurs sind noch keine Klausuren angelegt.'));
    return details;
  }

  for (const exam of exams) {
    const section = el('section', undefined, 'klausur-block');
    section.append(el('h3',
      `${exam.titel} · ${exam.datum} · max. ${showNumber(exam.maxPunkte)} Punkte`));

    const form = document.createElement('form');
    form.dataset.examGrades = '';
    form.dataset.examId = exam.pruefungId;
    const table = document.createElement('table');
    table.className = 'noten-tabelle';

    const head = document.createElement('tr');
    ['Person', 'Erreichte Punkte', 'Prozent', 'Note'].forEach((text) =>
      head.append(el('th', text)));
    const thead = document.createElement('thead');
    thead.append(head);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const student of studentsIn(course)) {
      const saved = gradeForExam(course, exam, student);
      const tr = document.createElement('tr');
      tr.append(el('th', `${student.nachname}, ${student.vorname}`));

      const points = field(`punkte-${student.id}`, 'number', saved?.punkte ?? '', false);
      points.min = '0';
      points.max = exam.maxPunkte;
      points.step = '0.1';
      const pointCell = document.createElement('td');
      pointCell.append(points);
      tr.append(pointCell);

      const result = saved
        ? examGrade(Number(saved.punkte), Number(exam.maxPunkte))
        : null;
      tr.append(el('td', result ? `${result.percent} %` : '—'));
      tr.append(el('td', result ? String(result.grade) : '—'));
      tbody.append(tr);
    }

    table.append(tbody);
    const tableBox = el('div', undefined, 'noten-tabelle-box');
    tableBox.append(table);
    form.append(tableBox);

    const save = el('button', 'Punkte speichern', 'btn btn--sekundaer');
    save.type = 'submit';
    form.append(save);
    section.append(form);
    details.append(section);
  }
  return details;
}

function buildOverview(course) {
  const details = document.createElement('details');
  details.open = true;
  details.append(el('summary', 'Notenübersicht'));

  const table = document.createElement('table');
  table.className = 'noten-tabelle';
  const headings = [
    'Person',
    'SoLei H1',
    'SoLei H2',
    'SoLei Jahr',
    'Klausuren H1',
    'Klausuren H2',
    'Klausuren Jahr',
    'Zeugnisnote errechnet',
    'Zeugnisnote Lehrkraft',
    'Tendenz'
  ];

  const head = document.createElement('tr');
  headings.forEach((text) => head.append(el('th', text)));
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const students = studentsAverage(course);

  for (const student of students) {
    const tr = document.createElement('tr');
    tr.append(el('th', `${student.nachname}, ${student.vorname}`));
    const values = [
      calculatedSolei(course, student, 0),
      calculatedSolei(course, student, 1),
      annualSolei(course, student),
      examAverage(course, student, 0),
      examAverage(course, student, 1),
      examAverage(course, student),
      weightedGrade(course, student),
      manualGrade(course, student),
      tendency(course, student)
    ];

    values.forEach((value, index) => {
      if (index === 7) {
        const cell = document.createElement('td');
        const form = document.createElement('form');
        form.dataset.manualGrade = '';
        form.dataset.personId = student.id;
        const inputNote = field('note', 'number', value ?? '', false);
        inputNote.min = '1';
        inputNote.max = '6';
        inputNote.step = '0.1';
        inputNote.setAttribute('aria-label',
          `Manuelle Zeugnisnote für ${student.vorname} ${student.nachname}`);
        const button = el('button', 'Speichern', 'btn btn--sekundaer');
        button.type = 'submit';
        form.append(inputNote, button);
        cell.append(form);
        tr.append(cell);
      } else {
        tr.append(el('td',
          typeof value === 'number' ? showNumber(value) : String(value ?? '—')));
      }
    });
    tbody.append(tr);
  }

  const averageRow = document.createElement('tr');
  averageRow.className = 'noten-klassenschnitt';
  averageRow.append(el('th', 'Klassenschnitt'));

  const avgColumns = [
    (s) => calculatedSolei(course, s, 0),
    (s) => calculatedSolei(course, s, 1),
    (s) => annualSolei(course, s),
    (s) => examAverage(course, s, 0),
    (s) => examAverage(course, s, 1),
    (s) => examAverage(course, s),
    (s) => weightedGrade(course, s),
    (s) => manualGrade(course, s),
    null
  ];

  avgColumns.forEach((getValue) => {
    averageRow.append(el('td', getValue
      ? (mean(students.map(getValue)) === null ? '—' : showNumber(mean(students.map(getValue))))
      : '—'));
  });

  tbody.append(averageRow);
  table.append(tbody);
  const box = el('div', undefined, 'noten-tabelle-box');
  box.append(table);
  details.append(box);
  return details;
}

function buildReportSelector(course) {
  const details = document.createElement('details');
  details.append(el('summary', 'Einzelbericht fürs Notengespräch'));

  const select = document.createElement('select');
  select.dataset.reportStudent = '';
  addOption(select, '', 'Person auswählen');
  for (const student of studentsIn(course)) {
    addOption(select, student.id, `${student.nachname}, ${student.vorname}`);
  }

  const button = el('button', 'Bericht anzeigen / drucken', 'btn');
  button.type = 'button';
  button.dataset.action = 'report';
  details.append(label('Person', select), button);

  const output = el('div');
  output.dataset.reportOutput = '';
  details.append(output);
  return details;
}

/* ------------------------------------------------------------------ */
/* Drucken und Speichern                                               */
/* ------------------------------------------------------------------ */

function renderReport(course, student) {
  const output = $('[data-report-output]');
  output.replaceChildren();

  const report = el('article', undefined, 'noten-bericht');
  report.append(
    el('h2', 'Notenbericht fürs Notengespräch'),
    el('p', `${student.vorname} ${student.nachname} · ${className(course)} · ${course.fach ?? course.name}`)
  );

  const table = document.createElement('table');
  table.className = 'noten-tabelle';
  const head = document.createElement('tr');
  ['Bereich', '1. Halbjahr', '2. Halbjahr', 'Jahr'].forEach((text) =>
    head.append(el('th', text)));
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const body = document.createElement('tbody');
  const rows = [
    ['SoLei',
      calculatedSolei(course, student, 0),
      calculatedSolei(course, student, 1),
      annualSolei(course, student)],
    ['Klausuren',
      examAverage(course, student, 0),
      examAverage(course, student, 1),
      examAverage(course, student)],
    ['Errechnete Zeugnisnote',
      weightedGrade(course, student, 0),
      weightedGrade(course, student, 1),
      weightedGrade(course, student)]
  ];

  for (const [title, ...values] of rows) {
    const tr = document.createElement('tr');
    tr.append(el('th', title));
    values.forEach((value) =>
      tr.append(el('td', value === null ? '—' : showNumber(value))));
    body.append(tr);
  }

  table.append(body);
  report.append(table);
  report.append(el('h3', 'Klausurergebnisse'));

  const exams = examsFor(course);
  if (!exams.length) {
    report.append(el('p', 'Keine Klausuren erfasst.'));
  } else {
    const examTable = document.createElement('table');
    examTable.className = 'noten-tabelle';
    const examHead = document.createElement('tr');
    ['Klausur', 'Datum', 'Punkte', 'Prozent', 'Note'].forEach((text) =>
      examHead.append(el('th', text)));
    const examThead = document.createElement('thead');
    examThead.append(examHead);
    examTable.append(examThead);

    const examBody = document.createElement('tbody');
    for (const exam of exams) {
      const result = gradeForExam(course, exam, student);
      const grade = result
        ? examGrade(Number(result.punkte), Number(exam.maxPunkte))
        : null;
      const tr = document.createElement('tr');
      [
        exam.titel,
        exam.datum,
        result ? `${showNumber(result.punkte)} / ${showNumber(exam.maxPunkte)}` : '—',
        grade ? `${grade.percent} %` : '—',
        grade ? String(grade.grade) : '—'
      ].forEach((text, index) =>
        tr.append(index === 0 ? el('th', text) : el('td', text)));
      examBody.append(tr);
    }
    examTable.append(examBody);
    report.append(examTable);
  }

  report.append(
    el('h3', 'Notizen zum Gespräch'),
    el('div', undefined, 'noten-bericht-notiz')
  );
  output.append(report);
}

async function saveWeights(form) {
  const solei = Number(form.elements.solei.value);
  const klausuren = Number(form.elements.klausuren.value);
  if (![solei, klausuren].every(Number.isFinite)
      || solei < 0 || klausuren < 0
      || solei + klausuren !== 100) {
    throw new Error('Die Gewichtungen müssen nicht negativ sein und zusammen 100 % ergeben.');
  }

  const course = activeCourse();
  const allCourses = await alleLaden(STORES.KURSE);
  const saved = allCourses.find((item) => item.id === course.id);
  if (!saved) throw new Error('Kurs nicht gefunden.');

  saved.einstellungen ??= {};
  saved.einstellungen.notenGewichtung = { solei, klausuren };
  await speichern(STORES.KURSE, saved);
}

async function saveExam(form) {
  const course = activeCourse();
  const title = form.elements.titel.value.trim();
  const date = form.elements.datum.value;
  const max = Number(form.elements.maxPunkte.value);

  if (!title || !date || !Number.isFinite(max) || max <= 0) {
    throw new Error('Bitte Bezeichnung, Datum und eine positive Maximalpunktzahl angeben.');
  }

  await speichern(STORES.LEISTUNGEN, {
    typ: 'klausur-definition',
    kursId: course.id,
    klasseId: course.klasseId,
    pruefungId: crypto.randomUUID(),
    titel: title,
    datum: date,
    maxPunkte: max
  });
}

async function saveExamGrades(form) {
  const course = activeCourse();
  const exam = examsFor(course).find((item) =>
    item.pruefungId === form.dataset.examId);
  if (!exam) throw new Error('Klausur nicht gefunden.');

  for (const student of studentsIn(course)) {
    const raw = form.elements[`punkte-${student.id}`].value.trim();
    const existing = gradeForExam(course, exam, student);
    if (!raw) continue;

    const points = Number(raw);
    if (!Number.isFinite(points) || points < 0 || points > Number(exam.maxPunkte)) {
      throw new Error(`${student.vorname} ${student.nachname}: Punkte müssen zwischen 0 und der Maximalpunktzahl liegen.`);
    }

    await speichern(STORES.LEISTUNGEN, {
      ...(existing ?? {}),
      typ: 'klausur-note',
      kursId: course.id,
      klasseId: course.klasseId,
      pruefungId: exam.pruefungId,
      personId: student.id,
      punkte
    });
  }
}

async function saveManualGrade(form) {
  const course = activeCourse();
  const studentId = Number(form.dataset.personId);
  const raw = form.elements.note.value.trim().replace(',', '.');
  const existing = record('zeugnisnote', {
    kursId: course.id,
    personId: studentId
  });

  if (!raw) {
    if (existing) {
      await speichern(STORES.LEISTUNGEN, {
        ...existing,
        note: null,
        aktualisiertAm: new Date().toISOString()
      });
    }
    return;
  }

  const note = Number(raw);
  if (!Number.isFinite(note) || note < 1 || note > 6) {
    throw new Error('Die manuelle Zeugnisnote muss zwischen 1,0 und 6,0 liegen.');
  }

  await speichern(STORES.LEISTUNGEN, {
    ...(existing ?? {}),
    typ: 'zeugnisnote',
    kursId: course.id,
    klasseId: course.klasseId,
    personId: studentId,
    note,
    aktualisiertAm: new Date().toISOString()
  });
}

async function handleSubmit(event) {
  const form = event.target.closest('form');
  if (!form || busy) return;

  const handlers = [
    ['weights', saveWeights],
    ['newExam', saveExam],
    ['examGrades', saveExamGrades],
    ['manualGrade', saveManualGrade]
  ];
  const match = handlers.find(([key]) => key in form.dataset);
  if (!match) return;

  event.preventDefault();
  busy = true;
  try {
    await match[1](form);
    await loadData();
    draw();
    status('Gespeichert.');
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-action="report"]');
  if (!button) return;

  const course = activeCourse();
  const id = Number($('[data-report-student]').value);
  const student = studentsIn(course).find((item) => item.id === id);
  if (!student) {
    status('Bitte zuerst eine Person für den Bericht auswählen.', true);
    return;
  }

  renderReport(course, student);
  window.print();
}

export { examGrade };
