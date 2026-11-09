(function () {
  'use strict';

  class ScenePlayer {
    constructor(courseData) {
      this.course = courseData;
      this.scene = null;
      this.shotIndex = 0;
      this.elapsedSeconds = 0;
      this.sceneComplete = false;
    }

    loadScene(sceneId, shotSourceId) {
      const scene = this.course.scenes.find((item) => item.id === sceneId);
      if (!scene) throw new Error(`Unknown scene: ${sceneId}`);
      this.scene = scene;
      // Restore the scene gate directly; this sentinel must not fall back to shot zero.
      if (shotSourceId === 'complete') {
        this.shotIndex = scene.shots.length;
        this.sceneComplete = true;
      } else {
        const restoredIndex = shotSourceId ? scene.shots.findIndex((shot) => shot.sourceId === shotSourceId) : 0;
        this.shotIndex = Math.max(0, restoredIndex);
        this.sceneComplete = false;
      }
      this.elapsedSeconds = 0;
      return this.getState();
    }

    completeShot(shotId) {
      if (!this.scene || this.sceneComplete) return this.getState();
      const current = this.scene.shots[this.shotIndex];
      if (!current || current.sourceId !== shotId) return this.getState();
      this.shotIndex += 1;
      this.elapsedSeconds = 0;
      this.sceneComplete = this.shotIndex >= this.scene.shots.length;
      return this.getState();
    }

    addElapsed(seconds) {
      if (Number.isFinite(seconds) && seconds > 0 && !this.sceneComplete) this.elapsedSeconds += seconds;
      return this.getState();
    }

    getCurrentShot() {
      return this.scene && !this.sceneComplete ? this.scene.shots[this.shotIndex] : null;
    }

    getState() {
      const shot = this.getCurrentShot();
      return {
        sceneId: this.scene ? this.scene.id : null,
        shotId: shot ? shot.sourceId : null,
        sceneComplete: this.sceneComplete,
        elapsedSeconds: this.elapsedSeconds
      };
    }
  }

  window.ScenePlayer = ScenePlayer;
}());
