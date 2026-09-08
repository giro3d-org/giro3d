/*
 * Copyright (c) 2015-2018, IGN France.
 * Copyright (c) 2018-2026, Giro3D team.
 * SPDX-License-Identifier: MIT
 */

import { Toast } from 'bootstrap';
import OSM from 'ol/source/OSM.js';
import { AmbientLight, Color, DirectionalLight, GridHelper, MathUtils, Mesh, Vector3 } from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';

import CoordinateSystem from '@giro3d/giro3d/core/geographic/CoordinateSystem.js';
import Instance from '@giro3d/giro3d/core/Instance.js';
import ColorLayer from '@giro3d/giro3d/core/layer/ColorLayer.js';
import Globe from '@giro3d/giro3d/entities/Globe.js';
import Tiles3D from '@giro3d/giro3d/entities/Tiles3D.js';
import Inspector from '@giro3d/giro3d/gui/Inspector.js';
import TiledImageSource from '@giro3d/giro3d/sources/TiledImageSource.js';

import { bindButton } from './widgets/bindButton.js';
import { bindNumberInput } from './widgets/bindNumberInput.js';
import { bindSlider } from './widgets/bindSlider.js';
import StatusBar from './widgets/StatusBar.js';

const TILESET_URL_INPUT_ID = 'url';
const DEFAULT_URL = 'https://3d.oslandia.com/3dtiles/19_rue_Marc_Antoine_Petit_ifc/tileset.json';
const input = document.getElementById(TILESET_URL_INPUT_ID);
// @ts-expect-error placeholder does not exist on HtmlElement
input.placeholder = DEFAULT_URL;

const tmpVec3 = new Vector3();

const params = {
    globeOpacity: 1,
    tilesetOpacity: 1,
    errorTarget: 8,
};

function replace_window_url(enteredUrl) {
    const url = new URL(document.URL);
    url.searchParams.delete(TILESET_URL_INPUT_ID);

    url.searchParams.append(TILESET_URL_INPUT_ID, enteredUrl);

    window.history.replaceState({}, null, url.toString());
}

// init instance
const instance = new Instance({
    target: 'view', // The id of the <div> to attach the instance
    crs: CoordinateSystem.epsg3857,
    backgroundColor: 0xcccccc,
});

// Add a sunlight
const sun = new DirectionalLight('#ffffff', 1.4);
sun.position.set(1, 0, 1).normalize();
sun.updateMatrixWorld(true);
instance.scene.add(sun);

// We can look below the floor, so let's light also a bit there
const sun2 = new DirectionalLight('#ffffff', 0.5);
sun2.position.set(0, -1, 1);
sun2.updateMatrixWorld();
instance.scene.add(sun2);

// Add ambient light
const ambientLight = new AmbientLight(0xffffff, 1);
instance.scene.add(ambientLight);
instance.view.minNearPlane = 0.5;

// create controls
const controls = new MapControls(instance.view.camera, instance.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.25;
instance.view.setControls(controls);

const globe = new Globe({
    backgroundColor: '#aad3df',
});

globe.helperColor = 'black';

instance.add(globe);

const layer = new ColorLayer({
    source: new TiledImageSource({ source: new OSM() }),
});

globe.addLayer(layer);

// declare the tileset
/** @type {Tiles3D} */
let tileset = null;

// setup the error displaying
const toastLiveExample = document.getElementById('liveToast');
const toastBootstrap = Toast.getOrCreateInstance(toastLiveExample);
function displayError(evt) {
    document.getElementById('error').innerText = evt.error.message;
    toastBootstrap.show();
}

function run(url) {
    if (tileset != null) {
        instance.remove(tileset);
    }
    tileset = new Tiles3D({ url: url.toString() });

    // If the tileset comes from an ifc converted with py3dtiles, hide some elements that don't bring visual value
    tileset.addEventListener('object-created', evt => {
        const scene = evt.obj;
        scene.traverse(obj => {
            if (obj.userData?.class === 'IfcSpace') {
                obj.visible = false;
                instance.notifyChange();
            }
        });
    });

    instance.add(tileset).then(initializeCamera, displayError).catch(console.log);
}

function placeCamera(position, lookAt) {
    instance.view.camera.position.set(position.x, position.y, position.z);
    instance.view.camera.lookAt(lookAt);
    controls.target.copy(lookAt);
    StatusBar.updateUrl();
    instance.notifyChange(instance.view.camera);
}

// add pointcloud to scene
function initializeCamera() {
    const bbox = tileset.getBoundingBox();

    const ratio = bbox.getSize(tmpVec3).x / bbox.getSize(tmpVec3).z;

    const position = bbox
        .getCenter(new Vector3())
        .clone()
        .add(bbox.getSize(tmpVec3).multiply(new Vector3(-2, -2, ratio)));

    const lookAt = bbox.getCenter(tmpVec3);
    lookAt.z = bbox.min.z;

    placeCamera(position, lookAt);

    const grid = new GridHelper(60, 10);
    grid.rotateX(MathUtils.degToRad(90));

    grid.position.copy(lookAt);

    instance.add(grid);
    grid.updateMatrixWorld(true);
}

// url parsing and initialization
let tileset_url = new URL(document.URL).searchParams.get(TILESET_URL_INPUT_ID);

if (tileset_url == null) {
    tileset_url = DEFAULT_URL;
}

replace_window_url(tileset_url);
// @ts-expect-error value does not exist on HtmlElement
input.value = tileset_url;
run(tileset_url);

document.getElementById('start').onclick = () => {
    // @ts-expect-error value does not exist on HtmlElement
    const enteredUrl = input.value;

    if (enteredUrl != null) {
        replace_window_url(enteredUrl);
        run(enteredUrl);
    }
};

// picking and highlighting logic
const resultsTable = document.getElementById('results');

let highlighted;
let highlightColor = new Color(0xff7171);

let canPick = true;

/**
 * @param {MouseEvent} evt
 */
function highlight(evt) {
    if (!canPick) {
        return;
    }

    const picked = instance.pickObjectsAt(evt, {
        radius: 5,
        limit: 10,
        where: [tileset],
        filter: pick => pick.object.visible, // Ignore invisible objects, such as IfcSpace elements
    });

    if (highlighted && highlighted.material.color != null) {
        // reset style
        const material = highlighted.material;
        material.color.copy(material.userData.oldColor);

        instance.notifyChange(highlighted);
    }

    if (picked.length === 0) {
        document.getElementById('pick-result').style.display = 'none';
    } else {
        document.getElementById('pick-result').style.display = 'block';
        const obj = picked[0].object;
        if (obj instanceof Mesh) {
            const material = obj.material;

            // keep the old color to reset it later
            if (material.color != null) {
                if (!material.userData.oldColor) {
                    material.userData.oldColor = material.color.clone();
                }

                material.color.copy(highlightColor);
            }

            instance.notifyChange(obj);
            highlighted = obj;
        }

        const rows = [];

        for (const [name, value] of Object.entries(obj.userData)) {
            if (name !== 'oldColor' && name !== 'parentEntity') {
                const row = document.createElement('tr');
                const nameCell = document.createElement('td');
                nameCell.innerHTML = `<code>${name}</code>`;
                const valueCell = document.createElement('td');
                valueCell.innerText = value.toString().substring(0, 20);
                valueCell.title = value;
                row.append(nameCell, valueCell);
                rows.push(row);
            }
        }

        resultsTable.replaceChildren(...rows);
    }
}

// Prevent picking if user is dragging mouse
instance.domElement.addEventListener('mousedown', () => (canPick = true));
instance.domElement.addEventListener('mousemove', () => (canPick = false));
instance.domElement.addEventListener('mouseup', highlight);

function updateParams() {
    globe.opacity = params.globeOpacity;
    globe.visible = params.globeOpacity > 0;
    tileset.opacity = params.tilesetOpacity;
    tileset.visible = params.tilesetOpacity > 0;
    tileset.errorTarget = params.errorTarget;

    instance.notifyChange(globe);
}

updateParams();

bindSlider('globe-opacity', v => {
    params.globeOpacity = v;
    updateParams();
});
bindSlider('tileset-opacity', v => {
    params.tilesetOpacity = v;
    updateParams();
});
bindButton('center-view', () => {
    if (tileset) {
        instance.view.goTo(tileset);
    }
});
bindNumberInput('error-target', v => {
    params.errorTarget = v;
    updateParams();
});

Inspector.attach('inspector', instance);
StatusBar.bind(instance);
