class AnimatableProperty {
    static dirtyFlagList = []; // Collect all animatable properties with dirty flags set to true
    static resetAllDirtyFlags() {
        for (const prop of this.dirtyFlagList) {
            prop.dirty = false;
        }
        this.dirtyFlagList = [];
    }

    constructor(value) {
        this.restValue = value;
        this.animatedValue = null;
        this.dirty = true;
        AnimatableProperty.dirtyFlagList.push(this);
    }

    restAt(value) {
        if (!this.dirty) {
            this.dirty = true;
            AnimatableProperty.dirtyFlagList.push(this);
        }
        this.restValue = value;
    }

    animate(value) {
        if (!this.dirty) {
            this.dirty = true;
            AnimatableProperty.dirtyFlagList.push(this);
        }
        this.animatedValue = value;
    }

    rest() {
        if (!this.dirty) {
            this.dirty = true;
            AnimatableProperty.dirtyFlagList.push(this);
        }
        if (this.animatedValue !== null) {
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

// Binds a glTF 2.1 core property and its pre-2.1 extension counterpart to one
// AnimatableProperty, so both JSON pointers keep addressing the same state.
const linkPromotedProperty = (coreObject, coreProperty, extensionObject, extensionProperty) => {
    extensionObject.animatedPropertyObjects[extensionProperty] =
        coreObject.animatedPropertyObjects[coreProperty];
};

export { AnimatableProperty, makeAnimatable, linkPromotedProperty };
