## Classes

<dl>
<dt><a href="#GltfView">GltfView</a></dt>
<dd><p>GltfView represents a view on a gltf, e.g. in a canvas</p>
</dd>
<dt><a href="#GltfState">GltfState</a></dt>
<dd><p>GltfState containing a state for visualization in GltfView</p>
</dd>
<dt><a href="#AnimationTimer">AnimationTimer</a></dt>
<dd><p>AnimationTimer class to control animation playback.</p>
</dd>
<dt><a href="#ResourceLoader">ResourceLoader</a></dt>
<dd><p>ResourceLoader can be used to load resources for the GltfState
that are then used to display the loaded data with GltfView</p>
</dd>
<dt><a href="#UserCamera">UserCamera</a></dt>
<dd></dd>
<dt><a href="#GraphController">GraphController</a></dt>
<dd><p>A controller for managing KHR_interactivity graphs in a glTF scene.</p>
</dd>
</dl>

<a name="GltfView"></a>

## GltfView
GltfView represents a view on a gltf, e.g. in a canvas

**Kind**: global class  

* [GltfView](#GltfView)
    * [new GltfView(context)](#new_GltfView_new)
    * [.createState()](#GltfView+createState) ⇒ [<code>GltfState</code>](#GltfState)
    * [.createResourceLoader([externalDracoLib], [externalKtxLib], [libPath])](#GltfView+createResourceLoader) ⇒ [<code>ResourceLoader</code>](#ResourceLoader)
    * [.renderFrame(state, width, height)](#GltfView+renderFrame)
    * [.gatherStatistics(state)](#GltfView+gatherStatistics) ⇒ <code>Object</code>

<a name="new_GltfView_new"></a>

### new GltfView(context)
GltfView representing one WebGl 2.0 context or in other words one
3D rendering of the Gltf.
You can create multiple views for example when multiple canvases should
be shown on the same webpage.


| Param | Type | Description |
| --- | --- | --- |
| context | <code>\*</code> | WebGl 2.0 context. Get it from a canvas with `canvas.getContext("webgl2")` |

<a name="GltfView+createState"></a>

### gltfView.createState() ⇒ [<code>GltfState</code>](#GltfState)
createState constructs a new GltfState for the GltfView. The resources
referenced in a gltf state can directly be stored as resources on the WebGL
context of GltfView, therefore GltfStates cannot not be shared between
GltfViews.

**Kind**: instance method of [<code>GltfView</code>](#GltfView)  
**Returns**: [<code>GltfState</code>](#GltfState) - GltfState  
<a name="GltfView+createResourceLoader"></a>

### gltfView.createResourceLoader([externalDracoLib], [externalKtxLib], [libPath]) ⇒ [<code>ResourceLoader</code>](#ResourceLoader)
createResourceLoader creates a resource loader with which glTFs and
environments can be loaded for the view

**Kind**: instance method of [<code>GltfView</code>](#GltfView)  
**Returns**: [<code>ResourceLoader</code>](#ResourceLoader) - ResourceLoader  

| Param | Type | Description |
| --- | --- | --- |
| [externalDracoLib] | <code>Object</code> | optional object of an external Draco library, e.g. from a CDN |
| [externalKtxLib] | <code>Object</code> | optional object of an external KTX library, e.g. from a CDN |
| [libPath] | <code>string</code> | optional path to the libraries. Used to define the path to the WASM files on repackaging |

<a name="GltfView+renderFrame"></a>

### gltfView.renderFrame(state, width, height)
renderFrame to the context's default frame buffer
Call this function in the javascript animation update loop for continuous rendering to a canvas

**Kind**: instance method of [<code>GltfView</code>](#GltfView)  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>\*</code> | GltfState that is be used for rendering |
| width | <code>\*</code> | of the viewport |
| height | <code>\*</code> | of the viewport |

<a name="GltfView+gatherStatistics"></a>

### gltfView.gatherStatistics(state) ⇒ <code>Object</code>
gatherStatistics collects information about the GltfState such as the number of
rendered meshes or triangles

**Kind**: instance method of [<code>GltfView</code>](#GltfView)  
**Returns**: <code>Object</code> - an object containing statistics information  

| Param | Type | Description |
| --- | --- | --- |
| state | <code>\*</code> | GltfState about which the statistics should be collected |

<a name="GltfState"></a>

## GltfState
GltfState containing a state for visualization in GltfView

**Kind**: global class  

* [GltfState](#GltfState)
    * [new GltfState(view)](#new_GltfState_new)
    * _instance_
        * [.gltf](#GltfState+gltf)
        * [.environment](#GltfState+environment)
        * [.userCamera](#GltfState+userCamera)
        * [.sceneIndex](#GltfState+sceneIndex)
        * [.cameraNodeIndex](#GltfState+cameraNodeIndex)
        * [.animationIndices](#GltfState+animationIndices)
        * [.animationTimer](#GltfState+animationTimer)
        * [.variant](#GltfState+variant)
        * [.graphController](#GltfState+graphController)
        * [.selectionCallback](#GltfState+selectionCallback)
        * [.hoverCallback](#GltfState+hoverCallback)
        * [.triggerSelection](#GltfState+triggerSelection)
        * [.enableHover](#GltfState+enableHover)
        * [.renderingParameters](#GltfState+renderingParameters)
            * [.morphing](#GltfState+renderingParameters.morphing)
            * [.skinning](#GltfState+renderingParameters.skinning)
            * [.enabledExtensions](#GltfState+renderingParameters.enabledExtensions)
                * [.KHR_materials_clearcoat](#GltfState+renderingParameters.enabledExtensions.KHR_materials_clearcoat)
                * [.KHR_materials_sheen](#GltfState+renderingParameters.enabledExtensions.KHR_materials_sheen)
                * [.KHR_materials_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_transmission)
                * [.KHR_materials_volume](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume)
                * [.KHR_materials_volume_scatter](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume_scatter)
                * [.KHR_materials_ior](#GltfState+renderingParameters.enabledExtensions.KHR_materials_ior)
                * [.KHR_materials_specular](#GltfState+renderingParameters.enabledExtensions.KHR_materials_specular)
                * [.KHR_materials_iridescence](#GltfState+renderingParameters.enabledExtensions.KHR_materials_iridescence)
                * [.KHR_materials_diffuse_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission)
                * [.KHR_materials_anisotropy](#GltfState+renderingParameters.enabledExtensions.KHR_materials_anisotropy)
                * [.KHR_materials_dispersion](#GltfState+renderingParameters.enabledExtensions.KHR_materials_dispersion)
                * [.KHR_materials_emissive_strength](#GltfState+renderingParameters.enabledExtensions.KHR_materials_emissive_strength)
                * [.KHR_interactivity](#GltfState+renderingParameters.enabledExtensions.KHR_interactivity)
                * [.KHR_node_hoverability](#GltfState+renderingParameters.enabledExtensions.KHR_node_hoverability)
                * [.KHR_node_selectability](#GltfState+renderingParameters.enabledExtensions.KHR_node_selectability)
                * [.KHR_node_visibility](#GltfState+renderingParameters.enabledExtensions.KHR_node_visibility)
            * [.clearColor](#GltfState+renderingParameters.clearColor)
            * [.exposure](#GltfState+renderingParameters.exposure)
            * [.usePunctual](#GltfState+renderingParameters.usePunctual)
            * [.useIBL](#GltfState+renderingParameters.useIBL)
            * [.iblIntensity](#GltfState+renderingParameters.iblIntensity)
            * [.renderEnvironmentMap](#GltfState+renderingParameters.renderEnvironmentMap)
            * [.blurEnvironmentMap](#GltfState+renderingParameters.blurEnvironmentMap)
            * [.toneMap](#GltfState+renderingParameters.toneMap)
            * [.debugOutput](#GltfState+renderingParameters.debugOutput)
            * [.environmentRotation](#GltfState+renderingParameters.environmentRotation)
            * [.useDirectionalLightsWithDisabledIBL](#GltfState+renderingParameters.useDirectionalLightsWithDisabledIBL)
            * [.internalMSAA](#GltfState+renderingParameters.internalMSAA)
    * _static_
        * [.ToneMaps](#GltfState.ToneMaps)
            * [.KHR_PBR_NEUTRAL](#GltfState.ToneMaps.KHR_PBR_NEUTRAL)
            * [.ACES_HILL_EXPOSURE_BOOST](#GltfState.ToneMaps.ACES_HILL_EXPOSURE_BOOST)
            * [.ACES_NARKOWICZ](#GltfState.ToneMaps.ACES_NARKOWICZ)
            * [.ACES_HILL](#GltfState.ToneMaps.ACES_HILL)
            * [.NONE](#GltfState.ToneMaps.NONE)
        * [.DebugOutput](#GltfState.DebugOutput)
            * [.NONE](#GltfState.DebugOutput.NONE)
            * [.generic](#GltfState.DebugOutput.generic)
                * [.UV_COORDS_0](#GltfState.DebugOutput.generic.UV_COORDS_0)
                * [.UV_COORDS_1](#GltfState.DebugOutput.generic.UV_COORDS_1)
                * [.NORMAL](#GltfState.DebugOutput.generic.NORMAL)
                * [.GEOMETRYNORMAL](#GltfState.DebugOutput.generic.GEOMETRYNORMAL)
                * [.TANGENT](#GltfState.DebugOutput.generic.TANGENT)
                * [.BITANGENT](#GltfState.DebugOutput.generic.BITANGENT)
                * [.TANGENTW](#GltfState.DebugOutput.generic.TANGENTW)
                * [.WORLDSPACENORMAL](#GltfState.DebugOutput.generic.WORLDSPACENORMAL)
                * [.ALPHA](#GltfState.DebugOutput.generic.ALPHA)
                * [.OCCLUSION](#GltfState.DebugOutput.generic.OCCLUSION)
                * [.EMISSIVE](#GltfState.DebugOutput.generic.EMISSIVE)
            * [.mr](#GltfState.DebugOutput.mr)
                * [.BASECOLOR](#GltfState.DebugOutput.mr.BASECOLOR)
                * [.METALLIC](#GltfState.DebugOutput.mr.METALLIC)
                * [.ROUGHNESS](#GltfState.DebugOutput.mr.ROUGHNESS)
            * [.clearcoat](#GltfState.DebugOutput.clearcoat)
                * [.CLEARCOAT_FACTOR](#GltfState.DebugOutput.clearcoat.CLEARCOAT_FACTOR)
                * [.CLEARCOAT_ROUGHNESS](#GltfState.DebugOutput.clearcoat.CLEARCOAT_ROUGHNESS)
                * [.CLEARCOAT_NORMAL](#GltfState.DebugOutput.clearcoat.CLEARCOAT_NORMAL)
            * [.sheen](#GltfState.DebugOutput.sheen)
                * [.SHEEN_COLOR](#GltfState.DebugOutput.sheen.SHEEN_COLOR)
                * [.SHEEN_ROUGHNESS](#GltfState.DebugOutput.sheen.SHEEN_ROUGHNESS)
            * [.specular](#GltfState.DebugOutput.specular)
                * [.SPECULAR_FACTOR](#GltfState.DebugOutput.specular.SPECULAR_FACTOR)
                * [.SPECULAR_COLOR](#GltfState.DebugOutput.specular.SPECULAR_COLOR)
            * [.transmission](#GltfState.DebugOutput.transmission)
                * [.TRANSMISSION_FACTOR](#GltfState.DebugOutput.transmission.TRANSMISSION_FACTOR)
                * [.VOLUME_THICKNESS](#GltfState.DebugOutput.transmission.VOLUME_THICKNESS)
            * [.diffuseTransmission](#GltfState.DebugOutput.diffuseTransmission)
                * [.DIFFUSE_TRANSMISSION_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_FACTOR)
                * [.DIFFUSE_TRANSMISSION_COLOR_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_COLOR_FACTOR)
            * [.iridescence](#GltfState.DebugOutput.iridescence)
                * [.IRIDESCENCE_FACTOR](#GltfState.DebugOutput.iridescence.IRIDESCENCE_FACTOR)
                * [.IRIDESCENCE_THICKNESS](#GltfState.DebugOutput.iridescence.IRIDESCENCE_THICKNESS)
            * [.anisotropy](#GltfState.DebugOutput.anisotropy)
                * [.ANISOTROPIC_STRENGTH](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_STRENGTH)
                * [.ANISOTROPIC_DIRECTION](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_DIRECTION)

<a name="new_GltfState_new"></a>

### new GltfState(view)
GltfState represents all state that can be visualized in a view. You could have
multiple GltfStates configured and switch between them on demand.


| Param | Type | Description |
| --- | --- | --- |
| view | <code>\*</code> | GltfView to which this state belongs |

<a name="GltfState+gltf"></a>

### gltfState.gltf
loaded gltf data @see ResourceLoader.loadGltf

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+environment"></a>

### gltfState.environment
loaded environment data @see ResourceLoader.loadEnvironment

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+userCamera"></a>

### gltfState.userCamera
user camera @see UserCamera, convenient camera controls

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+sceneIndex"></a>

### gltfState.sceneIndex
gltf scene that is visible in the view

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+cameraNodeIndex"></a>

### gltfState.cameraNodeIndex
index of the camera node that is used to render the view. a
value of 'undefined' enables the user camera

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+animationIndices"></a>

### gltfState.animationIndices
indices of active animations

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+animationTimer"></a>

### gltfState.animationTimer
animation timer allows to control the animation time

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+variant"></a>

### gltfState.variant
KHR_materials_variants

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+graphController"></a>

### gltfState.graphController
the graph controller allows selecting and playing graphs from KHR_interactivity

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+selectionCallback"></a>

### gltfState.selectionCallback
callback for selection: (selectionInfo : {
node,
position,
rayOrigin,
controller }) => {}

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+hoverCallback"></a>

### gltfState.hoverCallback
callback for hovering: (hoverInfo : { node, controller }) => {}

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+triggerSelection"></a>

### gltfState.triggerSelection
If the renderer should compute selection information in the next frame. Is automatically reset after the frame is rendered

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+enableHover"></a>

### gltfState.enableHover
If the renderer should compute hover information in the next frame.

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  
<a name="GltfState+renderingParameters"></a>

### gltfState.renderingParameters
parameters used to configure the rendering

**Kind**: instance property of [<code>GltfState</code>](#GltfState)  

* [.renderingParameters](#GltfState+renderingParameters)
    * [.morphing](#GltfState+renderingParameters.morphing)
    * [.skinning](#GltfState+renderingParameters.skinning)
    * [.enabledExtensions](#GltfState+renderingParameters.enabledExtensions)
        * [.KHR_materials_clearcoat](#GltfState+renderingParameters.enabledExtensions.KHR_materials_clearcoat)
        * [.KHR_materials_sheen](#GltfState+renderingParameters.enabledExtensions.KHR_materials_sheen)
        * [.KHR_materials_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_transmission)
        * [.KHR_materials_volume](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume)
        * [.KHR_materials_volume_scatter](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume_scatter)
        * [.KHR_materials_ior](#GltfState+renderingParameters.enabledExtensions.KHR_materials_ior)
        * [.KHR_materials_specular](#GltfState+renderingParameters.enabledExtensions.KHR_materials_specular)
        * [.KHR_materials_iridescence](#GltfState+renderingParameters.enabledExtensions.KHR_materials_iridescence)
        * [.KHR_materials_diffuse_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission)
        * [.KHR_materials_anisotropy](#GltfState+renderingParameters.enabledExtensions.KHR_materials_anisotropy)
        * [.KHR_materials_dispersion](#GltfState+renderingParameters.enabledExtensions.KHR_materials_dispersion)
        * [.KHR_materials_emissive_strength](#GltfState+renderingParameters.enabledExtensions.KHR_materials_emissive_strength)
        * [.KHR_interactivity](#GltfState+renderingParameters.enabledExtensions.KHR_interactivity)
        * [.KHR_node_hoverability](#GltfState+renderingParameters.enabledExtensions.KHR_node_hoverability)
        * [.KHR_node_selectability](#GltfState+renderingParameters.enabledExtensions.KHR_node_selectability)
        * [.KHR_node_visibility](#GltfState+renderingParameters.enabledExtensions.KHR_node_visibility)
    * [.clearColor](#GltfState+renderingParameters.clearColor)
    * [.exposure](#GltfState+renderingParameters.exposure)
    * [.usePunctual](#GltfState+renderingParameters.usePunctual)
    * [.useIBL](#GltfState+renderingParameters.useIBL)
    * [.iblIntensity](#GltfState+renderingParameters.iblIntensity)
    * [.renderEnvironmentMap](#GltfState+renderingParameters.renderEnvironmentMap)
    * [.blurEnvironmentMap](#GltfState+renderingParameters.blurEnvironmentMap)
    * [.toneMap](#GltfState+renderingParameters.toneMap)
    * [.debugOutput](#GltfState+renderingParameters.debugOutput)
    * [.environmentRotation](#GltfState+renderingParameters.environmentRotation)
    * [.useDirectionalLightsWithDisabledIBL](#GltfState+renderingParameters.useDirectionalLightsWithDisabledIBL)
    * [.internalMSAA](#GltfState+renderingParameters.internalMSAA)

<a name="GltfState+renderingParameters.morphing"></a>

#### renderingParameters.morphing
morphing between vertices

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.skinning"></a>

#### renderingParameters.skinning
skin / skeleton

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.enabledExtensions"></a>

#### renderingParameters.enabledExtensions
enabled extensions

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  

* [.enabledExtensions](#GltfState+renderingParameters.enabledExtensions)
    * [.KHR_materials_clearcoat](#GltfState+renderingParameters.enabledExtensions.KHR_materials_clearcoat)
    * [.KHR_materials_sheen](#GltfState+renderingParameters.enabledExtensions.KHR_materials_sheen)
    * [.KHR_materials_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_transmission)
    * [.KHR_materials_volume](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume)
    * [.KHR_materials_volume_scatter](#GltfState+renderingParameters.enabledExtensions.KHR_materials_volume_scatter)
    * [.KHR_materials_ior](#GltfState+renderingParameters.enabledExtensions.KHR_materials_ior)
    * [.KHR_materials_specular](#GltfState+renderingParameters.enabledExtensions.KHR_materials_specular)
    * [.KHR_materials_iridescence](#GltfState+renderingParameters.enabledExtensions.KHR_materials_iridescence)
    * [.KHR_materials_diffuse_transmission](#GltfState+renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission)
    * [.KHR_materials_anisotropy](#GltfState+renderingParameters.enabledExtensions.KHR_materials_anisotropy)
    * [.KHR_materials_dispersion](#GltfState+renderingParameters.enabledExtensions.KHR_materials_dispersion)
    * [.KHR_materials_emissive_strength](#GltfState+renderingParameters.enabledExtensions.KHR_materials_emissive_strength)
    * [.KHR_interactivity](#GltfState+renderingParameters.enabledExtensions.KHR_interactivity)
    * [.KHR_node_hoverability](#GltfState+renderingParameters.enabledExtensions.KHR_node_hoverability)
    * [.KHR_node_selectability](#GltfState+renderingParameters.enabledExtensions.KHR_node_selectability)
    * [.KHR_node_visibility](#GltfState+renderingParameters.enabledExtensions.KHR_node_visibility)

<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_clearcoat"></a>

##### enabledExtensions.KHR\_materials\_clearcoat
KHR_materials_clearcoat adds a clear coat layer on top of the glTF base material

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_sheen"></a>

##### enabledExtensions.KHR\_materials\_sheen
KHR_materials_sheen adds a sheen layer on top of the glTF base material

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_transmission"></a>

##### enabledExtensions.KHR\_materials\_transmission
KHR_materials_transmission adds physical-based transparency

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_volume"></a>

##### enabledExtensions.KHR\_materials\_volume
KHR_materials_volume adds support for volumetric materials. Used together with KHR_materials_transmission and KHR_materials_diffuse_transmission

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_volume_scatter"></a>

##### enabledExtensions.KHR\_materials\_volume\_scatter
KHR_materials_volume_scatter allows the simulation of scattering light inside a volume. Used together with KHR_materials_volume

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_ior"></a>

##### enabledExtensions.KHR\_materials\_ior
KHR_materials_ior makes the index of refraction configurable

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_specular"></a>

##### enabledExtensions.KHR\_materials\_specular
KHR_materials_specular allows configuring specular color (f0 color) and amount of specular reflection

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_iridescence"></a>

##### enabledExtensions.KHR\_materials\_iridescence
KHR_materials_iridescence adds a thin-film iridescence effect

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_diffuse_transmission"></a>

##### enabledExtensions.KHR\_materials\_diffuse\_transmission
KHR_materials_diffuse_transmission allows light to pass diffusely through the material

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_anisotropy"></a>

##### enabledExtensions.KHR\_materials\_anisotropy
KHR_materials_anisotropy defines microfacet grooves in the surface, stretching the specular reflection on the surface

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_dispersion"></a>

##### enabledExtensions.KHR\_materials\_dispersion
KHR_materials_dispersion defines configuring the strength of the angular separation of colors (chromatic abberation)

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_materials_emissive_strength"></a>

##### enabledExtensions.KHR\_materials\_emissive\_strength
KHR_materials_emissive_strength enables emissive factors larger than 1.0

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_interactivity"></a>

##### enabledExtensions.KHR\_interactivity
KHR_interactivity enables execution of a behavior graph

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_node_hoverability"></a>

##### enabledExtensions.KHR\_node\_hoverability
KHR_node_hoverability enables hovering over nodes

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_node_selectability"></a>

##### enabledExtensions.KHR\_node\_selectability
KHR_node_selectability enables selecting nodes

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.enabledExtensions.KHR_node_visibility"></a>

##### enabledExtensions.KHR\_node\_visibility
KHR_node_visibility enables controlling the visibility of nodes

**Kind**: static property of [<code>enabledExtensions</code>](#GltfState+renderingParameters.enabledExtensions)  
<a name="GltfState+renderingParameters.clearColor"></a>

#### renderingParameters.clearColor
clear color expressed as list of ints in the range [0, 255]

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.exposure"></a>

#### renderingParameters.exposure
exposure factor

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.usePunctual"></a>

#### renderingParameters.usePunctual
KHR_lights_punctual

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.useIBL"></a>

#### renderingParameters.useIBL
image based lighting

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.iblIntensity"></a>

#### renderingParameters.iblIntensity
image based lighting intensity

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.renderEnvironmentMap"></a>

#### renderingParameters.renderEnvironmentMap
render the environment map in the background

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.blurEnvironmentMap"></a>

#### renderingParameters.blurEnvironmentMap
apply blur to the background environment map

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.toneMap"></a>

#### renderingParameters.toneMap
which tonemap to use, use KHR_PBR_NEUTRAL for best color reproduction

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.debugOutput"></a>

#### renderingParameters.debugOutput
render some debug output channes, such as for example the normals

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.environmentRotation"></a>

#### renderingParameters.environmentRotation
By default the front face of the environment is +Z (90)
Front faces:
+X = 0
+Z = 90
-X = 180
-Z = 270

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.useDirectionalLightsWithDisabledIBL"></a>

#### renderingParameters.useDirectionalLightsWithDisabledIBL
If this is set to true, directional lights will be generated if IBL is disabled

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState+renderingParameters.internalMSAA"></a>

#### renderingParameters.internalMSAA
MSAA used for cases which are not handled by the browser (e.g. Transmission)

**Kind**: static property of [<code>renderingParameters</code>](#GltfState+renderingParameters)  
<a name="GltfState.ToneMaps"></a>

### GltfState.ToneMaps
ToneMaps enum for the different tonemappings that are supported
by gltf sample viewer

**Kind**: static property of [<code>GltfState</code>](#GltfState)  

* [.ToneMaps](#GltfState.ToneMaps)
    * [.KHR_PBR_NEUTRAL](#GltfState.ToneMaps.KHR_PBR_NEUTRAL)
    * [.ACES_HILL_EXPOSURE_BOOST](#GltfState.ToneMaps.ACES_HILL_EXPOSURE_BOOST)
    * [.ACES_NARKOWICZ](#GltfState.ToneMaps.ACES_NARKOWICZ)
    * [.ACES_HILL](#GltfState.ToneMaps.ACES_HILL)
    * [.NONE](#GltfState.ToneMaps.NONE)

<a name="GltfState.ToneMaps.KHR_PBR_NEUTRAL"></a>

#### ToneMaps.KHR\_PBR\_NEUTRAL
Khronos PBR neutral tone mapping, see https://github.com/KhronosGroup/ToneMapping, https://modelviewer.dev/examples/tone-mapping

**Kind**: static property of [<code>ToneMaps</code>](#GltfState.ToneMaps)  
<a name="GltfState.ToneMaps.ACES_HILL_EXPOSURE_BOOST"></a>

#### ToneMaps.ACES\_HILL\_EXPOSURE\_BOOST
ACES sRGB RRT+ODT implementation for 3D Commerce based on Stephen Hill's implementation with a exposure factor of 1.0 / 0.6

**Kind**: static property of [<code>ToneMaps</code>](#GltfState.ToneMaps)  
<a name="GltfState.ToneMaps.ACES_NARKOWICZ"></a>

#### ToneMaps.ACES\_NARKOWICZ
fast implementation of the ACES sRGB RRT+ODT based on Krzysztof Narkowicz' implementation

**Kind**: static property of [<code>ToneMaps</code>](#GltfState.ToneMaps)  
<a name="GltfState.ToneMaps.ACES_HILL"></a>

#### ToneMaps.ACES\_HILL
more accurate implementation of the ACES sRGB RRT+ODT based on Stephen Hill's implementation

**Kind**: static property of [<code>ToneMaps</code>](#GltfState.ToneMaps)  
<a name="GltfState.ToneMaps.NONE"></a>

#### ToneMaps.NONE
Linear mapping, clamped at 1.0 per channel

**Kind**: static property of [<code>ToneMaps</code>](#GltfState.ToneMaps)  
<a name="GltfState.DebugOutput"></a>

### GltfState.DebugOutput
DebugOutput enum for selecting debug output channels
such as "NORMAL"

**Kind**: static property of [<code>GltfState</code>](#GltfState)  

* [.DebugOutput](#GltfState.DebugOutput)
    * [.NONE](#GltfState.DebugOutput.NONE)
    * [.generic](#GltfState.DebugOutput.generic)
        * [.UV_COORDS_0](#GltfState.DebugOutput.generic.UV_COORDS_0)
        * [.UV_COORDS_1](#GltfState.DebugOutput.generic.UV_COORDS_1)
        * [.NORMAL](#GltfState.DebugOutput.generic.NORMAL)
        * [.GEOMETRYNORMAL](#GltfState.DebugOutput.generic.GEOMETRYNORMAL)
        * [.TANGENT](#GltfState.DebugOutput.generic.TANGENT)
        * [.BITANGENT](#GltfState.DebugOutput.generic.BITANGENT)
        * [.TANGENTW](#GltfState.DebugOutput.generic.TANGENTW)
        * [.WORLDSPACENORMAL](#GltfState.DebugOutput.generic.WORLDSPACENORMAL)
        * [.ALPHA](#GltfState.DebugOutput.generic.ALPHA)
        * [.OCCLUSION](#GltfState.DebugOutput.generic.OCCLUSION)
        * [.EMISSIVE](#GltfState.DebugOutput.generic.EMISSIVE)
    * [.mr](#GltfState.DebugOutput.mr)
        * [.BASECOLOR](#GltfState.DebugOutput.mr.BASECOLOR)
        * [.METALLIC](#GltfState.DebugOutput.mr.METALLIC)
        * [.ROUGHNESS](#GltfState.DebugOutput.mr.ROUGHNESS)
    * [.clearcoat](#GltfState.DebugOutput.clearcoat)
        * [.CLEARCOAT_FACTOR](#GltfState.DebugOutput.clearcoat.CLEARCOAT_FACTOR)
        * [.CLEARCOAT_ROUGHNESS](#GltfState.DebugOutput.clearcoat.CLEARCOAT_ROUGHNESS)
        * [.CLEARCOAT_NORMAL](#GltfState.DebugOutput.clearcoat.CLEARCOAT_NORMAL)
    * [.sheen](#GltfState.DebugOutput.sheen)
        * [.SHEEN_COLOR](#GltfState.DebugOutput.sheen.SHEEN_COLOR)
        * [.SHEEN_ROUGHNESS](#GltfState.DebugOutput.sheen.SHEEN_ROUGHNESS)
    * [.specular](#GltfState.DebugOutput.specular)
        * [.SPECULAR_FACTOR](#GltfState.DebugOutput.specular.SPECULAR_FACTOR)
        * [.SPECULAR_COLOR](#GltfState.DebugOutput.specular.SPECULAR_COLOR)
    * [.transmission](#GltfState.DebugOutput.transmission)
        * [.TRANSMISSION_FACTOR](#GltfState.DebugOutput.transmission.TRANSMISSION_FACTOR)
        * [.VOLUME_THICKNESS](#GltfState.DebugOutput.transmission.VOLUME_THICKNESS)
    * [.diffuseTransmission](#GltfState.DebugOutput.diffuseTransmission)
        * [.DIFFUSE_TRANSMISSION_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_FACTOR)
        * [.DIFFUSE_TRANSMISSION_COLOR_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_COLOR_FACTOR)
    * [.iridescence](#GltfState.DebugOutput.iridescence)
        * [.IRIDESCENCE_FACTOR](#GltfState.DebugOutput.iridescence.IRIDESCENCE_FACTOR)
        * [.IRIDESCENCE_THICKNESS](#GltfState.DebugOutput.iridescence.IRIDESCENCE_THICKNESS)
    * [.anisotropy](#GltfState.DebugOutput.anisotropy)
        * [.ANISOTROPIC_STRENGTH](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_STRENGTH)
        * [.ANISOTROPIC_DIRECTION](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_DIRECTION)

<a name="GltfState.DebugOutput.NONE"></a>

#### DebugOutput.NONE
standard rendering - debug output is disabled

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  
<a name="GltfState.DebugOutput.generic"></a>

#### DebugOutput.generic
generic debug outputs

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.generic](#GltfState.DebugOutput.generic)
    * [.UV_COORDS_0](#GltfState.DebugOutput.generic.UV_COORDS_0)
    * [.UV_COORDS_1](#GltfState.DebugOutput.generic.UV_COORDS_1)
    * [.NORMAL](#GltfState.DebugOutput.generic.NORMAL)
    * [.GEOMETRYNORMAL](#GltfState.DebugOutput.generic.GEOMETRYNORMAL)
    * [.TANGENT](#GltfState.DebugOutput.generic.TANGENT)
    * [.BITANGENT](#GltfState.DebugOutput.generic.BITANGENT)
    * [.TANGENTW](#GltfState.DebugOutput.generic.TANGENTW)
    * [.WORLDSPACENORMAL](#GltfState.DebugOutput.generic.WORLDSPACENORMAL)
    * [.ALPHA](#GltfState.DebugOutput.generic.ALPHA)
    * [.OCCLUSION](#GltfState.DebugOutput.generic.OCCLUSION)
    * [.EMISSIVE](#GltfState.DebugOutput.generic.EMISSIVE)

<a name="GltfState.DebugOutput.generic.UV_COORDS_0"></a>

##### generic.UV\_COORDS\_0
output the texture coordinates 0

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.UV_COORDS_1"></a>

##### generic.UV\_COORDS\_1
output the texture coordinates 1

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.NORMAL"></a>

##### generic.NORMAL
output the world space normals (i.e. with TBN applied)

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.GEOMETRYNORMAL"></a>

##### generic.GEOMETRYNORMAL
output the normal from the TBN

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.TANGENT"></a>

##### generic.TANGENT
output the tangent from the TBN

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.BITANGENT"></a>

##### generic.BITANGENT
output the bitangent from the TBN

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.TANGENTW"></a>

##### generic.TANGENTW
output the tangent w from the TBN (black corresponds to -1; white to 1

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.WORLDSPACENORMAL"></a>

##### generic.WORLDSPACENORMAL
output the world space normals (i.e. with TBN applied)

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.ALPHA"></a>

##### generic.ALPHA
output the alpha value

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.OCCLUSION"></a>

##### generic.OCCLUSION
output the occlusion value

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.generic.EMISSIVE"></a>

##### generic.EMISSIVE
output the emissive value

**Kind**: static property of [<code>generic</code>](#GltfState.DebugOutput.generic)  
<a name="GltfState.DebugOutput.mr"></a>

#### DebugOutput.mr
metallic roughness

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.mr](#GltfState.DebugOutput.mr)
    * [.BASECOLOR](#GltfState.DebugOutput.mr.BASECOLOR)
    * [.METALLIC](#GltfState.DebugOutput.mr.METALLIC)
    * [.ROUGHNESS](#GltfState.DebugOutput.mr.ROUGHNESS)

<a name="GltfState.DebugOutput.mr.BASECOLOR"></a>

##### mr.BASECOLOR
output the base color value

**Kind**: static property of [<code>mr</code>](#GltfState.DebugOutput.mr)  
<a name="GltfState.DebugOutput.mr.METALLIC"></a>

##### mr.METALLIC
output the metallic value from pbr metallic roughness

**Kind**: static property of [<code>mr</code>](#GltfState.DebugOutput.mr)  
<a name="GltfState.DebugOutput.mr.ROUGHNESS"></a>

##### mr.ROUGHNESS
output the roughness value from pbr metallic roughness

**Kind**: static property of [<code>mr</code>](#GltfState.DebugOutput.mr)  
<a name="GltfState.DebugOutput.clearcoat"></a>

#### DebugOutput.clearcoat
KHR_materials_clearcoat

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.clearcoat](#GltfState.DebugOutput.clearcoat)
    * [.CLEARCOAT_FACTOR](#GltfState.DebugOutput.clearcoat.CLEARCOAT_FACTOR)
    * [.CLEARCOAT_ROUGHNESS](#GltfState.DebugOutput.clearcoat.CLEARCOAT_ROUGHNESS)
    * [.CLEARCOAT_NORMAL](#GltfState.DebugOutput.clearcoat.CLEARCOAT_NORMAL)

<a name="GltfState.DebugOutput.clearcoat.CLEARCOAT_FACTOR"></a>

##### clearcoat.CLEARCOAT\_FACTOR
output the clear coat strength

**Kind**: static property of [<code>clearcoat</code>](#GltfState.DebugOutput.clearcoat)  
<a name="GltfState.DebugOutput.clearcoat.CLEARCOAT_ROUGHNESS"></a>

##### clearcoat.CLEARCOAT\_ROUGHNESS
output the clear coat roughness

**Kind**: static property of [<code>clearcoat</code>](#GltfState.DebugOutput.clearcoat)  
<a name="GltfState.DebugOutput.clearcoat.CLEARCOAT_NORMAL"></a>

##### clearcoat.CLEARCOAT\_NORMAL
output the clear coat normal

**Kind**: static property of [<code>clearcoat</code>](#GltfState.DebugOutput.clearcoat)  
<a name="GltfState.DebugOutput.sheen"></a>

#### DebugOutput.sheen
KHR_materials_sheen

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.sheen](#GltfState.DebugOutput.sheen)
    * [.SHEEN_COLOR](#GltfState.DebugOutput.sheen.SHEEN_COLOR)
    * [.SHEEN_ROUGHNESS](#GltfState.DebugOutput.sheen.SHEEN_ROUGHNESS)

<a name="GltfState.DebugOutput.sheen.SHEEN_COLOR"></a>

##### sheen.SHEEN\_COLOR
output the sheen color

**Kind**: static property of [<code>sheen</code>](#GltfState.DebugOutput.sheen)  
<a name="GltfState.DebugOutput.sheen.SHEEN_ROUGHNESS"></a>

##### sheen.SHEEN\_ROUGHNESS
output the sheen roughness

**Kind**: static property of [<code>sheen</code>](#GltfState.DebugOutput.sheen)  
<a name="GltfState.DebugOutput.specular"></a>

#### DebugOutput.specular
KHR_materials_specular

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.specular](#GltfState.DebugOutput.specular)
    * [.SPECULAR_FACTOR](#GltfState.DebugOutput.specular.SPECULAR_FACTOR)
    * [.SPECULAR_COLOR](#GltfState.DebugOutput.specular.SPECULAR_COLOR)

<a name="GltfState.DebugOutput.specular.SPECULAR_FACTOR"></a>

##### specular.SPECULAR\_FACTOR
output the specular strength

**Kind**: static property of [<code>specular</code>](#GltfState.DebugOutput.specular)  
<a name="GltfState.DebugOutput.specular.SPECULAR_COLOR"></a>

##### specular.SPECULAR\_COLOR
output the specular color

**Kind**: static property of [<code>specular</code>](#GltfState.DebugOutput.specular)  
<a name="GltfState.DebugOutput.transmission"></a>

#### DebugOutput.transmission
KHR_materials_transmission

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.transmission](#GltfState.DebugOutput.transmission)
    * [.TRANSMISSION_FACTOR](#GltfState.DebugOutput.transmission.TRANSMISSION_FACTOR)
    * [.VOLUME_THICKNESS](#GltfState.DebugOutput.transmission.VOLUME_THICKNESS)

<a name="GltfState.DebugOutput.transmission.TRANSMISSION_FACTOR"></a>

##### transmission.TRANSMISSION\_FACTOR
output the transmission strength

**Kind**: static property of [<code>transmission</code>](#GltfState.DebugOutput.transmission)  
<a name="GltfState.DebugOutput.transmission.VOLUME_THICKNESS"></a>

##### transmission.VOLUME\_THICKNESS
output the volume thickness

**Kind**: static property of [<code>transmission</code>](#GltfState.DebugOutput.transmission)  
<a name="GltfState.DebugOutput.diffuseTransmission"></a>

#### DebugOutput.diffuseTransmission
KHR_materials_diffuse_tranmission

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.diffuseTransmission](#GltfState.DebugOutput.diffuseTransmission)
    * [.DIFFUSE_TRANSMISSION_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_FACTOR)
    * [.DIFFUSE_TRANSMISSION_COLOR_FACTOR](#GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_COLOR_FACTOR)

<a name="GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_FACTOR"></a>

##### diffuseTransmission.DIFFUSE\_TRANSMISSION\_FACTOR
output the diffuse tranmission strength

**Kind**: static property of [<code>diffuseTransmission</code>](#GltfState.DebugOutput.diffuseTransmission)  
<a name="GltfState.DebugOutput.diffuseTransmission.DIFFUSE_TRANSMISSION_COLOR_FACTOR"></a>

##### diffuseTransmission.DIFFUSE\_TRANSMISSION\_COLOR\_FACTOR
output the diffuse tranmission color factor

**Kind**: static property of [<code>diffuseTransmission</code>](#GltfState.DebugOutput.diffuseTransmission)  
<a name="GltfState.DebugOutput.iridescence"></a>

#### DebugOutput.iridescence
KHR_materials_iridescence

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.iridescence](#GltfState.DebugOutput.iridescence)
    * [.IRIDESCENCE_FACTOR](#GltfState.DebugOutput.iridescence.IRIDESCENCE_FACTOR)
    * [.IRIDESCENCE_THICKNESS](#GltfState.DebugOutput.iridescence.IRIDESCENCE_THICKNESS)

<a name="GltfState.DebugOutput.iridescence.IRIDESCENCE_FACTOR"></a>

##### iridescence.IRIDESCENCE\_FACTOR
output the iridescence strength

**Kind**: static property of [<code>iridescence</code>](#GltfState.DebugOutput.iridescence)  
<a name="GltfState.DebugOutput.iridescence.IRIDESCENCE_THICKNESS"></a>

##### iridescence.IRIDESCENCE\_THICKNESS
output the iridescence thickness

**Kind**: static property of [<code>iridescence</code>](#GltfState.DebugOutput.iridescence)  
<a name="GltfState.DebugOutput.anisotropy"></a>

#### DebugOutput.anisotropy
KHR_materials_anisotropy

**Kind**: static property of [<code>DebugOutput</code>](#GltfState.DebugOutput)  

* [.anisotropy](#GltfState.DebugOutput.anisotropy)
    * [.ANISOTROPIC_STRENGTH](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_STRENGTH)
    * [.ANISOTROPIC_DIRECTION](#GltfState.DebugOutput.anisotropy.ANISOTROPIC_DIRECTION)

<a name="GltfState.DebugOutput.anisotropy.ANISOTROPIC_STRENGTH"></a>

##### anisotropy.ANISOTROPIC\_STRENGTH
output the anisotropic strength

**Kind**: static property of [<code>anisotropy</code>](#GltfState.DebugOutput.anisotropy)  
<a name="GltfState.DebugOutput.anisotropy.ANISOTROPIC_DIRECTION"></a>

##### anisotropy.ANISOTROPIC\_DIRECTION
output final direction as defined by the anisotropyTexture and rotation

**Kind**: static property of [<code>anisotropy</code>](#GltfState.DebugOutput.anisotropy)  
<a name="AnimationTimer"></a>

## AnimationTimer
AnimationTimer class to control animation playback.

**Kind**: global class  

* [AnimationTimer](#AnimationTimer)
    * [.start()](#AnimationTimer+start)
    * [.pause()](#AnimationTimer+pause)
    * [.unpause()](#AnimationTimer+unpause)
    * [.toggle()](#AnimationTimer+toggle)
    * [.reset()](#AnimationTimer+reset)
    * [.setFixedTime(timeInSec)](#AnimationTimer+setFixedTime)
    * [.elapsedSec()](#AnimationTimer+elapsedSec)

<a name="AnimationTimer+start"></a>

### animationTimer.start()
Start the animation timer and all animations

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="AnimationTimer+pause"></a>

### animationTimer.pause()
Pause all animations

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="AnimationTimer+unpause"></a>

### animationTimer.unpause()
Unpause all animations

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="AnimationTimer+toggle"></a>

### animationTimer.toggle()
Toggle the animation playback state

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="AnimationTimer+reset"></a>

### animationTimer.reset()
Reset the animation timer. If animations were playing, they will be restarted.

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="AnimationTimer+setFixedTime"></a>

### animationTimer.setFixedTime(timeInSec)
Plays all animations starting from the specified time

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  

| Param | Type | Description |
| --- | --- | --- |
| timeInSec | <code>number</code> | The time in seconds to set the animation timer to |

<a name="AnimationTimer+elapsedSec"></a>

### animationTimer.elapsedSec()
Get the elapsed time in seconds

**Kind**: instance method of [<code>AnimationTimer</code>](#AnimationTimer)  
<a name="ResourceLoader"></a>

## ResourceLoader
ResourceLoader can be used to load resources for the GltfState
that are then used to display the loaded data with GltfView

**Kind**: global class  

* [ResourceLoader](#ResourceLoader)
    * [new ResourceLoader(view, libPath)](#new_ResourceLoader_new)
    * [.loadGltf(gltfFile, [externalFiles])](#ResourceLoader+loadGltf) ⇒ <code>Promise</code>
    * [.loadEnvironment(environmentFile, [lutFiles])](#ResourceLoader+loadEnvironment) ⇒ <code>Promise</code>
    * [.initKtxLib([externalKtxLib])](#ResourceLoader+initKtxLib)
    * [.initDracoLib([externalDracoLib])](#ResourceLoader+initDracoLib)

<a name="new_ResourceLoader_new"></a>

### new ResourceLoader(view, libPath)
ResourceLoader class that provides an interface to load resources into
the view. Typically this is created with GltfView.createResourceLoader()
You cannot share resource loaders between GltfViews as some of the resources
are allocated directly on the WebGl2 Context


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| view | <code>Object</code> |  | the GltfView for which the resources are loaded |
| libPath | <code>String</code> | <code>./libs/</code> | path to the lib folder. This can be used to find the WASM files if sample viewer is repackaged |

<a name="ResourceLoader+loadGltf"></a>

### resourceLoader.loadGltf(gltfFile, [externalFiles]) ⇒ <code>Promise</code>
loadGltf asynchroneously and create resources for rendering

**Kind**: instance method of [<code>ResourceLoader</code>](#ResourceLoader)  
**Returns**: <code>Promise</code> - a promise that fulfills when the gltf file was loaded  

| Param | Type | Description |
| --- | --- | --- |
| gltfFile | <code>String</code> \| <code>ArrayBuffer</code> \| <code>File</code> | the .gltf or .glb file either as path or as preloaded resource. In node.js environments, only ArrayBuffer types are accepted. |
| [externalFiles] | <code>Array.&lt;File&gt;</code> | additional files containing resources that are referenced in the gltf |

<a name="ResourceLoader+loadEnvironment"></a>

### resourceLoader.loadEnvironment(environmentFile, [lutFiles]) ⇒ <code>Promise</code>
loadEnvironment asynchroneously, run IBL sampling and create resources for rendering

**Kind**: instance method of [<code>ResourceLoader</code>](#ResourceLoader)  
**Returns**: <code>Promise</code> - a promise that fulfills when the environment file was loaded  

| Param | Type | Description |
| --- | --- | --- |
| environmentFile | <code>String</code> \| <code>ArrayBuffer</code> \| <code>File</code> | the .hdr file either as path or resource |
| [lutFiles] | <code>Object</code> | object containing paths or resources for the environment look up textures. Keys are lut_ggx_file, lut_charlie_file and lut_sheen_E_file |

<a name="ResourceLoader+initKtxLib"></a>

### resourceLoader.initKtxLib([externalKtxLib])
initKtxLib must be called before loading gltf files with ktx2 assets

**Kind**: instance method of [<code>ResourceLoader</code>](#ResourceLoader)  

| Param | Type | Description |
| --- | --- | --- |
| [externalKtxLib] | <code>Object</code> | external ktx library (for example from a CDN) |

<a name="ResourceLoader+initDracoLib"></a>

### resourceLoader.initDracoLib([externalDracoLib])
initDracoLib must be called before loading gltf files with draco meshes

**Kind**: instance method of [<code>ResourceLoader</code>](#ResourceLoader)  

| Param | Type | Description |
| --- | --- | --- |
| [externalDracoLib] | <code>\*</code> | external draco library (for example from a CDN) |

<a name="UserCamera"></a>

## UserCamera
**Kind**: global class  

* [UserCamera](#UserCamera)
    * [new UserCamera()](#new_UserCamera_new)
    * [.setVerticalFoV(yfov)](#UserCamera+setVerticalFoV)
    * [.getPosition()](#UserCamera+getPosition)
    * [.getRotation()](#UserCamera+getRotation)
    * [.getLookDirection()](#UserCamera+getLookDirection)
    * [.getTarget()](#UserCamera+getTarget)
    * [.lookAt(from, to)](#UserCamera+lookAt)
    * [.setPosition(position)](#UserCamera+setPosition)
    * [.setTarget(target)](#UserCamera+setTarget)
    * [.setRotation(yaw, pitch)](#UserCamera+setRotation)
    * [.setDistanceFromTarget(distance, target)](#UserCamera+setDistanceFromTarget)
    * [.zoomBy(value)](#UserCamera+zoomBy)
    * [.orbit(x, y)](#UserCamera+orbit)
    * [.pan(x, y)](#UserCamera+pan)
    * [.resetView(gltf, sceneIndex)](#UserCamera+resetView)
    * [.fitViewToScene(gltf, sceneIndex)](#UserCamera+fitViewToScene)

<a name="new_UserCamera_new"></a>

### new UserCamera()
Create a new user camera.

<a name="UserCamera+setVerticalFoV"></a>

### userCamera.setVerticalFoV(yfov)
Sets the vertical FoV of the user camera.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| yfov | <code>number</code> | 

<a name="UserCamera+getPosition"></a>

### userCamera.getPosition()
Returns the current position of the user camera as a vec3.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  
<a name="UserCamera+getRotation"></a>

### userCamera.getRotation()
Returns the current rotation of the user camera as quat.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  
<a name="UserCamera+getLookDirection"></a>

### userCamera.getLookDirection()
Returns the normalized direction the user camera looks at as vec3.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  
<a name="UserCamera+getTarget"></a>

### userCamera.getTarget()
Returns the current target the camera looks at as vec3.
This multiplies the viewing direction with the distance.
For distance 0 the normalized viewing direction is used.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  
<a name="UserCamera+lookAt"></a>

### userCamera.lookAt(from, to)
Look from user camera to target.
This changes the transformation of the user camera.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| from | <code>vec3</code> | 
| to | <code>vec3</code> | 

<a name="UserCamera+setPosition"></a>

### userCamera.setPosition(position)
Sets the position of the user camera.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| position | <code>vec3</code> | 

<a name="UserCamera+setTarget"></a>

### userCamera.setTarget(target)
This rotates the user camera towards the target and sets the position of the user camera
according to the current distance.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| target | <code>vec3</code> | 

<a name="UserCamera+setRotation"></a>

### userCamera.setRotation(yaw, pitch)
Sets the rotation of the camera.
Yaw and pitch in euler angles (degrees).

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| yaw | <code>number</code> | 
| pitch | <code>number</code> | 

<a name="UserCamera+setDistanceFromTarget"></a>

### userCamera.setDistanceFromTarget(distance, target)
Transforms the user camera to look at a target from a specfic distance using the current rotation.
This will only change the position of the user camera, not the rotation.
Use this function to set the distance.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| distance | <code>number</code> | 
| target | <code>vec3</code> | 

<a name="UserCamera+zoomBy"></a>

### userCamera.zoomBy(value)
Zoom exponentially according to this.zoomFactor and this.zoomExponent.
The default zoomFactor provides good zoom speed for values from [-1,1].

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| value | <code>number</code> | 

<a name="UserCamera+orbit"></a>

### userCamera.orbit(x, y)
Orbit around the target.
x and y should be in radient and are added to the current rotation.
The rotation around the x-axis is limited to 180 degree.
The axes are inverted: e.g. if y is positive the camera will look further down.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| x | <code>number</code> | 
| y | <code>number</code> | 

<a name="UserCamera+pan"></a>

### userCamera.pan(x, y)
Pan the user camera.
The axes are inverted: e.g. if y is positive the camera will move down.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| x | <code>number</code> | 
| y | <code>number</code> | 

<a name="UserCamera+resetView"></a>

### userCamera.resetView(gltf, sceneIndex)
Calculates a camera position which looks at the center of the scene from an appropriate distance.
This calculates near and far plane as well.

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| gltf | <code>Gltf</code> | 
| sceneIndex | <code>number</code> | 

<a name="UserCamera+fitViewToScene"></a>

### userCamera.fitViewToScene(gltf, sceneIndex)
Fit view to updated canvas size without changing rotation if distance is incorrect

**Kind**: instance method of [<code>UserCamera</code>](#UserCamera)  

| Param | Type |
| --- | --- |
| gltf | <code>Gltf</code> | 
| sceneIndex | <code>number</code> | 

<a name="GraphController"></a>

## GraphController
A controller for managing KHR_interactivity graphs in a glTF scene.

**Kind**: global class  

* [GraphController](#GraphController)
    * [.initializeGraphs(state)](#GraphController+initializeGraphs)
    * [.loadGraph(graphIndex)](#GraphController+loadGraph) ⇒ <code>Array</code>
    * [.stopGraphEngine()](#GraphController+stopGraphEngine)
    * [.pauseGraph()](#GraphController+pauseGraph)
    * [.resumeGraph()](#GraphController+resumeGraph)
    * [.resetGraph()](#GraphController+resetGraph)
    * [.dispatchEvent(eventName, data)](#GraphController+dispatchEvent)
    * [.addCustomEventListener(eventName, callback)](#GraphController+addCustomEventListener)
    * [.clearCustomEventListeners()](#GraphController+clearCustomEventListeners)

<a name="GraphController+initializeGraphs"></a>

### graphController.initializeGraphs(state)
Initialize the graph controller with the given state.
This needs to be called every time a glTF assets is loaded.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  

| Param | Type | Description |
| --- | --- | --- |
| state | [<code>GltfState</code>](#GltfState) | The state of the application. |

<a name="GraphController+loadGraph"></a>

### graphController.loadGraph(graphIndex) ⇒ <code>Array</code>
Loads the specified graph. Resets the engine. Starts playing if this.playing is true.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
**Returns**: <code>Array</code> - An array of custom events defined in the graph.  

| Param | Type |
| --- | --- |
| graphIndex | <code>number</code> | 

<a name="GraphController+stopGraphEngine"></a>

### graphController.stopGraphEngine()
Stops the graph engine.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
<a name="GraphController+pauseGraph"></a>

### graphController.pauseGraph()
Pauses the currently playing graph.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
<a name="GraphController+resumeGraph"></a>

### graphController.resumeGraph()
Resumes the currently paused graph.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
<a name="GraphController+resetGraph"></a>

### graphController.resetGraph()
Resets the current graph.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
<a name="GraphController+dispatchEvent"></a>

### graphController.dispatchEvent(eventName, data)
Dispatches an event to the behavior engine.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  

| Param | Type |
| --- | --- |
| eventName | <code>string</code> | 
| data | <code>\*</code> | 

<a name="GraphController+addCustomEventListener"></a>

### graphController.addCustomEventListener(eventName, callback)
Adds a custom event listener to the decorator.
Khronos test assets use test/onStart, test/onFail and test/onSuccess.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  

| Param | Type |
| --- | --- |
| eventName | <code>string</code> | 
| callback | <code>function</code> | 

<a name="GraphController+clearCustomEventListeners"></a>

### graphController.clearCustomEventListeners()
Clears all custom event listeners from the decorator.

**Kind**: instance method of [<code>GraphController</code>](#GraphController)  
