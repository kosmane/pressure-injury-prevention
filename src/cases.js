(function () {
  'use strict';

  const CASES = Object.freeze({
    'case-1': Object.freeze({
      questionId: 'S074', reflectionId: 'S075', answerId: 'S076', correctOption: 'offload',
      options: [
        { id: 'offload', text: 'להפחית מיד לחץ מהאזור, להעריך את העור ולתכנן מניעה ומעקב.' },
        { id: 'massage', text: 'לעסות את האזור כדי להגביר את זרימת הדם.' },
        { id: 'wait', text: 'להשאיר את המטופל באותה תנוחה ולבדוק שוב במשמרת הבאה.' },
        { id: 'cream', text: 'למרוח תכשיר מקומי ולהסתפק בכך ללא שינוי בתנוחה.' }
      ]
    }),
    'case-2': Object.freeze({
      questionId: 'S077', reflectionId: 'S078', answerId: 'S079', correctOption: 'assess-device',
      options: [
        { id: 'assess-device', text: 'אומדן שלמות העור מתחת למכשיר פעם במשמרת, להפחית את הלחץ עם חבישת ספוג' },
        { id: 'remove-mask', text: 'להסיר מיד את המסכה בלי לוודא שקיימת חלופה בטוחה לתמיכה הנשימתית.' },
        { id: 'tighten', text: 'להדק את המסכה כדי למנוע את תזוזתה.' },
        { id: 'wait-device', text: 'להמשיך ללא שינוי ולבדוק את גשר האף רק למחרת.' }
      ]
    }),
    'case-3': Object.freeze({
      questionId: 'S080', reflectionId: 'S081', answerId: 'S082', correctOption: 'stage-three',
      options: [
        { id: 'stage-two', text: 'דרגה 2 — אובדן חלקי של עובי העור, ללא רקמת שומן גלויה.' },
        { id: 'stage-three', text: 'דרגה 3 — רקמת שומן גלויה; להפחית לחץ, לבצע הערכה ולתאם התייעצות עם אחות פצע.' },
        { id: 'stage-four', text: 'דרגה 4 — גם כאשר אין חשיפה של שריר, גיד או עצם.' },
        { id: 'unstageable', text: 'לא ניתנת לסיווג — כל פגיעה עמוקה מוגדרת כך.' }
      ]
    })
  });
  let activeCaseId = null;
  let verifiedCaseId = null;

  function findShot(sourceId) {
    const course = window.COURSE_DATA;
    if (!course || !Array.isArray(course.scenes)) return null;
    for (const scene of course.scenes) {
      const shot = scene.shots.find((item) => item.sourceId === sourceId);
      if (shot) return shot;
    }
    return null;
  }

  function caseForShot(sourceId) {
    for (const [caseId, definition] of Object.entries(CASES)) {
      if (sourceId === definition.questionId) return { caseId, phase: 'question' };
      if (sourceId === definition.reflectionId) return { caseId, phase: 'reflection' };
      if (sourceId === definition.answerId) return { caseId, phase: 'answer' };
    }
    return null;
  }

  function showPrompt(caseId) {
    const definition = CASES[caseId];
    if (!definition) return null;
    const reflection = findShot(definition.reflectionId);
    if (!reflection) return null;
    const question = findShot(definition.questionId) || reflection;
    activeCaseId = caseId;
    verifiedCaseId = null;
    return { caseId, question, reflection, revealed: false };
  }

  function quizForShot(sourceId) {
    const match = Object.entries(CASES).find(([, definition]) => definition.reflectionId === sourceId);
    if (!match) return null;
    const [caseId, definition] = match;
    return { caseId, prompt: findShot(definition.questionId)?.caption || findShot(definition.reflectionId)?.caption || '', options: definition.options };
  }

  function checkAnswer(caseId, optionId) {
    if (activeCaseId !== caseId || !CASES[caseId]) return false;
    const correct = CASES[caseId].correctOption === optionId;
    verifiedCaseId = correct ? caseId : null;
    return correct;
  }

  function completeQuestion(caseId) {
    if (!CASES[caseId] || activeCaseId !== caseId || verifiedCaseId !== caseId) return false;
    activeCaseId = null;
    verifiedCaseId = null;
    return true;
  }

  window.Cases = Object.freeze({ caseForShot, showPrompt, quizForShot, checkAnswer, completeQuestion });
}());


