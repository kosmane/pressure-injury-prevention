(function () {
  'use strict';

  const course = window.COURSE_DATA;
  const registry = window.ASSET_REGISTRY;
  const scorm = window.SCORMAdapter;
  const cases = window.Cases;
  const STORAGE_KEY = 'pressure-injury-course-progress-v1';
  const $ = (id) => document.getElementById(id);

  const creditScreen = $('credit-screen');
  const courseScreen = $('course-screen');
  const startButton = $('start-course');
  const orientationHint = $('orientation-hint');
  const sceneTitle = $('scene-title');
  const sceneProgress = $('scene-progress');
  const shotImage = $('shot-image');
  const nortonFrame = $('norton-frame');
  const pressureFrame = $('pressure-frame');
  const stage = $('stage');
  const placeholder = $('image-placeholder');
  const textOverlays = $('text-overlays');
  const caption = $('caption');
  const narration = $('narration');
  const voiceStatus = $('voice-status');
  const shotLabel = $('shot-label');
  const shotTime = $('shot-time');
  const voiceAudio = $('voice-audio');
  const pauseButton = $('pause-button');
  const shotNavigation = $('shot-navigation');
  const previousShotButton = $('previous-shot');
  const readConfirmationButton = $('read-confirmation');
  const nextShotButton = $('next-shot');
  const nextButton = $('next-scene');
  const homeButton = $('home-button');
  const restartButton = $('restart-course');
  const progressFill = $('scene-progress-fill');
  const progressBar = $('scene-progress-bar');
  const reflection = $('reflection');
  const reflectionQuestion = $('reflection-question');
  const caseOptions = $('case-options');
  const caseFeedback = $('case-feedback');
  const revealButton = $('reveal-answer');

  if (!course || !registry || !window.ScenePlayer) {
    startButton.disabled = true;
    startButton.textContent = 'הלומדה לא נטענה';
    return;
  }

  const player = new window.ScenePlayer(course);
  let sceneIndex = 0;
  let speed = 1;
  let paused = false;
  let running = false;
  let frameHandle = 0;
  let lastFrame = 0;
  let isReflection = false;
  let selectedCaseOption = null;
  let caseAnswerCorrect = false;
  let nortonComplete = false;
  let pressureMatchingComplete = false;
  let readConfirmed = false;
  let shotReady = false;
  let restoring = null;

  try { restoring = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { restoring = null; }

  function currentScene() { return course.scenes[sceneIndex]; }
  function currentShot() { return player.getCurrentShot(); }
  function isInteractiveShot(shot) {
    return shot?.interactionType === 'norton-matching' || shot?.interactionType === 'pressure-matching';
  }
  function setMotionSpeed() {
    stage.style.setProperty('--image-motion-duration', `${0.5 / speed}s`);
    stage.style.setProperty('--text-motion-duration', `${0.35 / speed}s`);
  }
  function restartMotion(element) {
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
  }
  function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }
  function saveProgress() {
    const state = player.getState();
    if (!state.sceneId) return;
    const progress = state.sceneComplete
      ? { sceneId: state.sceneId, shotId: 'complete', sceneComplete: true }
      : { sceneId: state.sceneId, shotId: state.shotId || null, sceneComplete: false };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (_) { /* Local persistence is optional. */ }
    restoring = progress;
    if (scorm) scorm.setProgress(state.sceneComplete ? `${state.sceneId}:complete` : `${state.sceneId}:${state.shotId || ''}`);
  }

  function validProgress(progress) {
    if (!progress || typeof progress.sceneId !== 'string') return null;
    const scene = course.scenes.find((item) => item.id === progress.sceneId);
    if (!scene) return null;
    if (progress.sceneComplete === true || progress.shotId === 'complete') {
      return { sceneId: progress.sceneId, shotId: 'complete', sceneComplete: true };
    }
    if (typeof progress.shotId !== 'string' || !scene.shots.some((shot) => shot.sourceId === progress.shotId)) return null;
    return { sceneId: progress.sceneId, shotId: progress.shotId };
  }

  function isPortraitPhone() {
    return window.matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
  }

  function updateOrientationHint() {
    orientationHint.hidden = courseScreen.hidden || !isPortraitPhone();
  }

  function requestLandscapeMode() {
    if (!isPortraitPhone()) return;
    const orientation = window.screen && window.screen.orientation;
    if (!orientation || typeof orientation.lock !== 'function') {
      updateOrientationHint();
      return;
    }

    const showRotationFallback = () => {
      const exitFullscreen = document.fullscreenElement === courseScreen && document.exitFullscreen;
      if (typeof exitFullscreen === 'function') {
        exitFullscreen.call(document).catch(updateOrientationHint);
        return;
      }
      updateOrientationHint();
    };
    const lockLandscape = () => {
      try {
        Promise.resolve(orientation.lock('landscape'))
          .then(updateOrientationHint)
          .catch(showRotationFallback);
      } catch (_) {
        showRotationFallback();
      }
    };
    const fullscreen = courseScreen.requestFullscreen;
    if (typeof fullscreen === 'function') {
      try {
        Promise.resolve(fullscreen.call(courseScreen))
          .then(lockLandscape)
          .catch(lockLandscape);
      } catch (_) {
        lockLandscape();
      }
      return;
    }

    lockLandscape();
  }

  function progressFromScorm(value) {
    if (typeof value !== 'string') return null;
    const separator = value.lastIndexOf(':');
    if (separator < 1) return null;
    return validProgress({ sceneId: value.slice(0, separator), shotId: value.slice(separator + 1) });
  }

  function isReflectionShot(shot) {
    const caseShot = shot && cases && cases.caseForShot(shot.sourceId);
    return Boolean(caseShot && caseShot.phase === 'reflection');
  }

  function stopVoice() {
    voiceAudio.pause();
    voiceAudio.onended = null;
    voiceAudio.onplaying = null;
    voiceAudio.onerror = null;
    voiceAudio.removeAttribute('src');
    voiceAudio.load();
  }

  function startVoice(shot) {
    voiceAudio.pause();
    voiceAudio.onended = () => {
      if (currentShot()?.sourceId !== shot.sourceId) return;
      shotReady = true;
      voiceStatus.textContent = 'הקריינות הסתיימה; עוברים לשוט הבא';
      progressFill.style.width = `${(shot.localShotNumber / currentScene().shots.length) * 100}%`;
      progressBar.setAttribute('aria-valuenow', String(Math.round((shot.localShotNumber / currentScene().shots.length) * 100)));
      advanceCurrentShot();
    };
    voiceAudio.onerror = () => {
      if (currentShot()?.sourceId === shot.sourceId) {
        voiceStatus.textContent = 'לא ניתן לטעון את הקריינות בשוט הזה';
      }
    };
    voiceAudio.src = shot.voiceFilename;
    if (!paused) {
      const playback = voiceAudio.play();
      if (playback?.catch) playback.catch(() => {
        if (currentShot()?.sourceId === shot.sourceId) {
          voiceStatus.textContent = 'לא ניתן להפעיל את הקריינות בשוט הזה';
        }
      });
    }
  }

  function setImage(shot) {
    const asset = shot && registry[shot.assetId];
    const src = asset && asset.path ? asset.path : '';
    if (!src) {
      shotImage.hidden = true;
      shotImage.removeAttribute('src');
      placeholder.hidden = false;
      return;
    }
    shotImage.onload = () => { shotImage.hidden = false; placeholder.hidden = true; };
    shotImage.onerror = () => { shotImage.hidden = true; placeholder.hidden = false; };
    shotImage.alt = shot.visual || '';
    restartMotion(shotImage);
    shotImage.src = src;
    if (shotImage.complete && shotImage.naturalWidth > 0) {
      shotImage.hidden = false;
      placeholder.hidden = true;
    } else {
      shotImage.hidden = true;
      placeholder.hidden = false;
    }
  }

  function setTransitionImage() {
    shotImage.alt = 'אחות מחייכת ומזמינה להמשיך לנושא הבא';
    shotImage.onload = () => { shotImage.hidden = false; placeholder.hidden = true; };
    shotImage.onerror = () => { shotImage.hidden = true; placeholder.hidden = false; };
    restartMotion(shotImage);
    shotImage.src = 'shared/transition-nurse.png';
    if (shotImage.complete && shotImage.naturalWidth > 0) {
      shotImage.hidden = false;
      placeholder.hidden = true;
    } else {
      shotImage.hidden = true;
      placeholder.hidden = false;
    }
  }

  function renderShot() {
    stage.classList.remove('is-closing');
    const scene = currentScene();
    const shot = currentShot();
    sceneTitle.textContent = scene.title;
    sceneProgress.textContent = `פרק ${scene.sceneNumber} מתוך ${course.scenes.length}`;
    nextButton.hidden = true;
    restartButton.hidden = true;
    reflection.hidden = true;
    shotReady = false;
    isReflection = isReflectionShot(shot);
    selectedCaseOption = null;
    caseAnswerCorrect = false;
    nortonComplete = false;
    pressureMatchingComplete = false;
    readConfirmed = false;
    readConfirmationButton.hidden = !shot?.requireReadConfirmation;
    readConfirmationButton.disabled = false;
    readConfirmationButton.textContent = 'אישור קריאה';
    previousShotButton.hidden = false;
    previousShotButton.textContent = 'אחורה';
    pauseButton.hidden = false;
    nextShotButton.hidden = false;
    caseOptions.replaceChildren();
    caseFeedback.textContent = '';
    caseFeedback.className = 'case-feedback';
    const caseShot = shot && cases && cases.caseForShot(shot.sourceId);
    if (caseShot && (caseShot.phase === 'question' || caseShot.phase === 'reflection')) cases.showPrompt(caseShot.caseId);

    if (!shot) {
      showSceneComplete();
      return;
    }

    const isNortonQuiz = shot.interactionType === 'norton-matching';
    const isPressureMatching = shot.interactionType === 'pressure-matching';
    const isInteractive = isNortonQuiz || isPressureMatching;
    stage.classList.toggle('is-reading', !!shot.requireReadConfirmation);
    stage.classList.toggle('has-norton-quiz', isInteractive);
    nortonFrame.hidden = !isNortonQuiz;
    pressureFrame.hidden = !isPressureMatching;
    if (isInteractive) {
      shotImage.hidden = true;
      placeholder.hidden = true;
      textOverlays.hidden = true;
      (isNortonQuiz ? nortonFrame : pressureFrame).src = shot.interactionSrc;
    } else setImage(shot);
    restartMotion(caption);
    restartMotion(narration);
    caption.textContent = shot.caption || '';
    caption.hidden = !shot.caption;
    narration.textContent = shot.narration || '';
    narration.hidden = !shot.narration;
    textOverlays.hidden = isInteractive || isReflection || (!shot.caption && !shot.narration);
    shotLabel.textContent = shot.label || `${shot.sceneNumber}-${shot.localShotNumber}`;
    shotTime.textContent = shot.voiceFilename
      ? 'הקריינות מתנגנת'
      : isInteractive
        ? 'תרגול אינטראקטיבי'
        : isReflection
          ? 'נדרשת תשובה נכונה'
          : shot.requireReadConfirmation
            ? 'נדרש אישור קריאה'
          : scene.sceneNumber === 7
            ? 'ללא המתנה'
            : `${shot.durationSeconds} שניות`;
    voiceStatus.textContent = isInteractive
      ? 'השלימו נכון את כל ההתאמות כדי להמשיך'
      : shot.voiceFilename
      ? 'הקריינות מתנגנת; השוט הבא יופיע בסיומה. אפשר ללחוץ „המשך” כדי לדלג'
      : isReflection
        ? 'בחרו תשובה נכונה כדי להמשיך'
        : shot.requireReadConfirmation
          ? 'עיינו באינפוגרפיקה ולחצו „אישור קריאה” כדי להמשיך'
        : scene.sceneNumber === 7
          ? 'אין קריינות בשוט הזה; אפשר להמשיך מיד'
          : 'שוט ללא קריינות; ההמשך ייפתח בסוף משך השוט';
    progressFill.style.width = `${Math.min(100, ((shot.localShotNumber - 1) / scene.shots.length) * 100)}%`;
    progressBar.setAttribute('aria-valuenow', String(Math.round(((shot.localShotNumber - 1) / scene.shots.length) * 100)));

    if (isReflection) {
      const quiz = cases && cases.quizForShot(shot.sourceId);
      reflectionQuestion.textContent = quiz?.prompt || shot.caption || '';
      if (quiz) {
        shuffled(quiz.options).forEach((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'case-option';
          button.dataset.optionId = option.id;
          button.setAttribute('aria-pressed', 'false');
          button.textContent = option.text;
          caseOptions.append(button);
        });
      }
      reflection.hidden = false;
      revealButton.disabled = true;
      revealButton.textContent = 'בדיקת תשובה';
      caption.hidden = true;
      narration.hidden = true;
    }
    if (shot.voiceFilename) startVoice(shot);
    else stopVoice();
    shotNavigation.hidden = false;
    updateShotNavigation();
    saveProgress();
  }

  function showSceneComplete() {
    stopVoice();
    stage.classList.remove('is-reading', 'has-norton-quiz');
    nortonFrame.hidden = true;
    pressureFrame.hidden = true;
    shotNavigation.hidden = false;
    previousShotButton.hidden = false;
    previousShotButton.disabled = false;
    previousShotButton.textContent = 'חזרה';
    pauseButton.hidden = true;
    nextShotButton.hidden = true;
    readConfirmationButton.hidden = true;
    textOverlays.hidden = true;
    const lastScene = sceneIndex === course.scenes.length - 1;
    stage.classList.toggle('is-closing', lastScene);
    voiceStatus.textContent = lastScene ? 'הפרק האחרון הסתיים' : 'הפרק הסתיים; אפשר לעבור לפרק הבא';
    if (lastScene) {
      setImage({ assetId: 'closing_team', visual: 'ביחד נמנע את פגיעת הלחץ הבאה — צוות רפואי יחד' });
    } else setTransitionImage();
    caption.hidden = true;
    narration.hidden = true;
    reflection.hidden = true;
    shotLabel.textContent = '';
    shotTime.textContent = '';
    progressFill.style.width = '100%';
    progressBar.setAttribute('aria-valuenow', '100');
    nextButton.hidden = false;
    nextButton.textContent = lastScene ? 'סיום הלומדה' : 'מעבר לפרק הבא';
    restartButton.hidden = !lastScene;
    nextButton.focus({ preventScroll: true });
  }

  function updateShotNavigation() {
    const scene = currentScene();
    const shot = currentShot();
    if (!scene || !shot) {
      shotNavigation.hidden = true;
      return;
    }
    const shotIndex = scene.shots.findIndex((item) => item.sourceId === shot.sourceId);
    previousShotButton.disabled = sceneIndex === 0 && shotIndex === 0;
    readConfirmationButton.hidden = !shot.requireReadConfirmation;
    nextShotButton.disabled = isInteractiveShot(shot)
      ? shot.interactionType === 'norton-matching' ? !nortonComplete : !pressureMatchingComplete
      : shot.requireReadConfirmation
        ? !readConfirmed
        : isReflection
        ? !caseAnswerCorrect
        : !shot.voiceFilename && !shotReady && currentScene().sceneNumber !== 7;
    nextShotButton.textContent = 'המשך';
  }

  function checkCurrentCaseAnswer() {
    const shot = currentShot();
    const caseShot = shot && cases && cases.caseForShot(shot.sourceId);
    if (!isReflection || !caseShot || !selectedCaseOption) return;
    caseAnswerCorrect = cases.checkAnswer(caseShot.caseId, selectedCaseOption);
    if (caseAnswerCorrect) {
      caseFeedback.textContent = 'נכון. אפשר להמשיך.';
      caseFeedback.className = 'case-feedback correct';
      revealButton.textContent = 'המשך';
    } else {
      caseFeedback.textContent = 'זו לא התשובה הנכונה. בחרו אפשרות אחרת ונסו שוב.';
      caseFeedback.className = 'case-feedback incorrect';
      revealButton.disabled = true;
      revealButton.textContent = 'בחרו תשובה אחרת';
    }
    updateShotNavigation();
  }

  function selectCaseOption(event) {
    const button = event.target.closest('[data-option-id]');
    if (!button || !caseOptions.contains(button)) return;
    selectedCaseOption = button.dataset.optionId;
    caseAnswerCorrect = false;
    caseOptions.querySelectorAll('[data-option-id]').forEach((option) => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    caseFeedback.textContent = '';
    caseFeedback.className = 'case-feedback';
    revealButton.disabled = false;
    revealButton.textContent = 'בדיקת תשובה';
    updateShotNavigation();
  }

  function completeCurrentQuestion() {
    if (!isReflection || !caseAnswerCorrect) return;
    const shot = currentShot();
    const caseShot = shot && cases && cases.caseForShot(shot.sourceId);
    if (!caseShot || !cases.completeQuestion(caseShot.caseId)) return;
    const next = player.completeShot(shot.sourceId);
    if (next.shotId === shot.sourceId) return;
    isReflection = false;
    renderShot();
  }

  function advanceCurrentShot() {
    const shot = currentShot();
    if (!shot) return;
    if (shot.interactionType === 'norton-matching' && !nortonComplete) return;
    if (shot.interactionType === 'pressure-matching' && !pressureMatchingComplete) return;
    if (shot.requireReadConfirmation && !readConfirmed) return;
    if (isReflection) {
      completeCurrentQuestion();
      return;
    }
    if (!shot.requireReadConfirmation && !shot.interactionType && !shot.voiceFilename && !shotReady && currentScene().sceneNumber !== 7) return;
    const state = player.completeShot(shot.sourceId);
    cancelAnimationFrame(frameHandle);
    if (state.sceneComplete) {
      running = false;
      saveProgress();
      showSceneComplete();
    } else {
      renderShot();
      running = !isReflection && !isInteractiveShot(currentShot());
      lastFrame = performance.now();
      if (running) frameHandle = requestAnimationFrame(tick);
    }
  }

  function goToPreviousShot() {
    const scene = currentScene();
    const shot = currentShot();
    if (!scene) return;
    if (!shot && player.getState().sceneComplete) {
      startScene(sceneIndex, scene.shots[scene.shots.length - 1].sourceId);
      return;
    }
    if (!shot) return;
    const shotIndex = scene.shots.findIndex((item) => item.sourceId === shot.sourceId);
    if (shotIndex > 0) {
      startScene(sceneIndex, scene.shots[shotIndex - 1].sourceId);
      return;
    }
    if (sceneIndex > 0) {
      const previousScene = course.scenes[sceneIndex - 1];
      startScene(sceneIndex - 1, previousScene.shots[previousScene.shots.length - 1].sourceId);
    }
  }

  function startScene(index, restoreShotId) {
    sceneIndex = index;
    player.loadScene(currentScene().id, restoreShotId);
    renderShot();
    running = !player.getState().sceneComplete && !isReflection && !isInteractiveShot(currentShot());
    lastFrame = performance.now();
    cancelAnimationFrame(frameHandle);
    if (running) frameHandle = requestAnimationFrame(tick);
  }

  function returnHome() {
    running = false;
    cancelAnimationFrame(frameHandle);
    stopVoice();
    paused = false;
    pauseButton.textContent = 'עצירה';
    pauseButton.setAttribute('aria-pressed', 'false');
    courseScreen.hidden = true;
    creditScreen.hidden = false;
    orientationHint.hidden = true;
    try { window.screen.orientation?.unlock?.(); } catch (_) { /* Optional browser API. */ }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    startButton.focus({ preventScroll: true });
  }

  function tick(now) {
    if (!running) return;
    const delta = Math.min((now - lastFrame) / 1000, .25);
    lastFrame = now;
    if (!paused) {
      const shot = currentShot();
      if (shot && (isReflection || isInteractiveShot(shot))) {
        running = false;
        return;
      } else if (shot && shot.voiceFilename) {
        const ratio = Number.isFinite(voiceAudio.duration) && voiceAudio.duration > 0
          ? Math.min(1, voiceAudio.currentTime / voiceAudio.duration)
          : 0;
        const percent = ((shot.localShotNumber - 1 + ratio) / currentScene().shots.length) * 100;
        progressFill.style.width = `${percent}%`;
        progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
      } else if (shot) {
        player.addElapsed(delta * speed);
        const state = player.getState();
        const duration = Number(shot.durationSeconds) || 5;
        const ratio = Math.min(1, state.elapsedSeconds / duration);
        progressFill.style.width = `${((shot.localShotNumber - 1 + ratio) / currentScene().shots.length) * 100}%`;
        progressBar.setAttribute('aria-valuenow', String(Math.round(((shot.localShotNumber - 1 + ratio) / currentScene().shots.length) * 100)));
        if (state.elapsedSeconds >= duration) {
          shotReady = true;
          running = false;
          updateShotNavigation();
          return;
        }
      }
    }
    frameHandle = requestAnimationFrame(tick);
  }

  startButton.addEventListener('click', () => {
    creditScreen.hidden = true;
    courseScreen.hidden = false;
    updateOrientationHint();
    requestLandscapeMode();
    if (scorm) scorm.initialize();
    let index = 0;
    let shotId;
    const savedProgress = scorm?.isAvailable
      ? progressFromScorm(scorm.getProgress())
      : validProgress(restoring);
    if (savedProgress) {
      const found = course.scenes.findIndex((scene) => scene.id === savedProgress.sceneId);
      if (found >= 0) { index = found; shotId = savedProgress.shotId; }
    }
    startScene(index, shotId);
  });

  window.addEventListener('resize', updateOrientationHint);
  window.addEventListener('orientationchange', updateOrientationHint);
  document.addEventListener('fullscreenchange', updateOrientationHint);

  homeButton.addEventListener('click', returnHome);

  document.querySelectorAll('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      speed = Number(button.dataset.speed) || 1;
      setMotionSpeed();
      document.querySelectorAll('[data-speed]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    });
  });

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    pauseButton.textContent = paused ? 'המשך' : 'עצירה';
    pauseButton.setAttribute('aria-pressed', String(paused));
    lastFrame = performance.now();
    const shot = currentShot();
    if (paused) voiceAudio.pause();
    else if (shot && shot.voiceFilename && !shotReady) {
      const playback = voiceAudio.play();
      if (playback?.catch) playback.catch(() => { voiceStatus.textContent = 'לא ניתן להפעיל את הקריינות בשוט הזה'; });
    }
    if (!shotReady && !running && !isReflection && !isInteractiveShot(shot)) {
      running = true;
      frameHandle = requestAnimationFrame(tick);
    }
  });

  previousShotButton.addEventListener('click', goToPreviousShot);
  nextShotButton.addEventListener('click', advanceCurrentShot);
  readConfirmationButton.addEventListener('click', () => {
    if (!currentShot()?.requireReadConfirmation) return;
    readConfirmed = true;
    readConfirmationButton.disabled = true;
    readConfirmationButton.textContent = 'הקריאה אושרה';
    voiceStatus.textContent = 'הקריאה אושרה. אפשר להמשיך.';
    updateShotNavigation();
  });
  caseOptions.addEventListener('click', selectCaseOption);
  revealButton.addEventListener('click', () => {
    if (caseAnswerCorrect) completeCurrentQuestion();
    else checkCurrentCaseAnswer();
  });

  window.addEventListener('message', (event) => {
    const shot = currentShot();
    if (event.source === nortonFrame.contentWindow && shot?.interactionType === 'norton-matching') {
      if (event.data?.type === 'norton-question-reset') {
        nortonComplete = false;
        voiceStatus.textContent = 'השלימו נכון את כל ההתאמות כדי להמשיך';
        updateShotNavigation();
      } else if (event.data?.type === 'norton-question-completed' && event.data.completed === true) {
        nortonComplete = true;
        voiceStatus.textContent = 'כל ההתאמות נכונות. אפשר להמשיך.';
        updateShotNavigation();
      } else if (event.data?.type === 'norton-question-continue' && nortonComplete) {
        advanceCurrentShot();
      }
      return;
    }
    if (event.source !== pressureFrame.contentWindow || shot?.interactionType !== 'pressure-matching') return;
    if (event.data?.type === 'pressure-matching-reset') {
      pressureMatchingComplete = false;
      voiceStatus.textContent = 'השלימו נכון את כל ההתאמות כדי להמשיך';
      updateShotNavigation();
    } else if (event.data?.type === 'pressure-matching-completed' && event.data.completed === true) {
      pressureMatchingComplete = true;
      voiceStatus.textContent = 'כל שש ההתאמות נכונות. אפשר להמשיך.';
      updateShotNavigation();
    } else if (event.data?.type === 'pressure-matching-continue' && event.data.completed === true && pressureMatchingComplete) {
      advanceCurrentShot();
    }
  });

  nextButton.addEventListener('click', () => {
    if (player.getState().sceneComplete !== true) return;
    if (sceneIndex >= course.scenes.length - 1) {
      running = false;
      if (scorm) scorm.complete();
      nextButton.hidden = true;
      restartButton.hidden = false;
      return;
    }
    startScene(sceneIndex + 1);
  });

  restartButton.addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* Local persistence is optional. */ }
    restoring = null;
    if (scorm) scorm.setProgress(`${course.scenes[0].id}:${course.scenes[0].shots[0].sourceId}`);
    returnHome();
  });

  window.addEventListener('pagehide', () => { if (scorm) scorm.terminate(); });
}());

