class AnimatableProperty {
    constructor(value) {
        this.restValue = value;
        this.animatedValue = null;
        this.dirty = true;
    }

    restAt(value) {
        this.dirty = true;
        this.restValue = value;
    }

    animate(value) {
        this.dirty = true;
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
}

const makeAnimatable = (object, json, properties) => {
    for (const property in properties) {
        object[property] = new AnimatableProperty(json[property] ?? properties[property]);
    }
};

export { AnimatableProperty, makeAnimatable };
