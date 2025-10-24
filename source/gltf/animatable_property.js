class AnimatableProperty {
    constructor(value) {
        this.restValue = value;
        this.animatedValue = null;
        this.dirty = true;
    }

    restAt(value) {
        if (!this.dirty && !this._equals(value, this.restValue)) {
            this.dirty = true;
        }
        this.restValue = value;
    }

    animate(value) {
        if (!this.dirty && !this._equals(value, this.animatedValue)) {
            this.dirty = true;
        }
        this.animatedValue = value;
    }

    rest() {
        if (this.animatedValue !== null) {
            this.dirty = true;
            this.animatedValue = null;
        }
    }

    value() {
        return this.animatedValue ?? this.restValue;
    }

    isDefined() {
        return this.restValue !== undefined;
    }

    _equals(first, second) {
        if (typeof first !== typeof second) {
            return false;
        }
        // We do not have animatable objects and arrays always have the same length
        if (Array.isArray(first) && Array.isArray(second)) {
            for (let i = 0; i < first.length; i++) {
                if (!this._equals(first[i], second[i])) {
                    return false;
                }
            }
            return true;
        } else {
            return first === second;
        }
    }
}

const makeAnimatable = (object, json, properties) => {
    for (const property in properties) {
        object[property] = new AnimatableProperty(json[property] ?? properties[property]);
    }
};

export { AnimatableProperty, makeAnimatable };
