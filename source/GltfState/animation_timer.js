/**
 * AnimationTimer class to control animation playback.
 */
class AnimationTimer {
    constructor() {
        this.startTime = 0;
        this.paused = true;
        this.fixedTime = null;
        this.pausedTime = 0;
    }

    /** Start the animation timer and all animations */
    start() {
        this.startTime = performance.now();
        this.paused = false;
    }

    /** Pause all animations */
    pause() {
        this.pausedTime = performance.now() - this.startTime;
        this.paused = true;
    }

    /** Unpause all animations */
    unpause() {
        this.startTime += performance.now() - this.startTime - this.pausedTime;
        this.paused = false;
    }

    /** Toggle the animation playback state */
    toggle() {
        if (this.paused) {
            this.unpause();
        } else {
            this.pause();
        }
    }

    /** Reset the animation timer. If animations were playing, they will be restarted. */
    reset() {
        if (!this.paused) {
            // Animation is running.
            this.startTime = performance.now();
        } else {
            this.startTime = 0;
        }
        this.pausedTime = 0;
    }

    /**
     * Plays all animations starting from the specified time
     * @param {number} timeInSec The time in seconds to set the animation timer to
     */
    setFixedTime(timeInSec) {
        this.paused = false;
        this.fixedTime = timeInSec;
    }

    /**
     * Sets the animation timer to a specific time while preserving whether it is
     * currently paused. If paused, the time stays put; if playing, playback
     * continues from the given time.
     * @param {number} timeInSec The time in seconds to set the animation timer to
     */
    setTime(timeInSec) {
        this.fixedTime = null;
        if (this.paused) {
            this.startTime = 0;
            this.pausedTime = timeInSec * 1000;
        } else {
            this.startTime = performance.now() - timeInSec * 1000;
        }
    }

    /** Get the elapsed time in seconds */
    elapsedSec() {
        if (this.paused) {
            return this.pausedTime / 1000;
        } else {
            return this.fixedTime ?? (performance.now() - this.startTime) / 1000;
        }
    }
}

export { AnimationTimer };
