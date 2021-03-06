/* global THREE */
const degs = rads => rads / Math.PI * 180;
const euler = new THREE.Euler();

export function stringifyRotation(r) {
  if (r.isEuler) {
    euler.set(r.x, r.y, r.z, r.order);
    if (r.order !== "YXZ") {
      euler.reorder("YXZ");
    }
  } else if (r.isMatrix4)
    euler.setFromRotationMatrix(r, "YXZ");
  else if (r.isQuaternion)
    euler.setFromQuaternion(r, "YXZ");
  else
    throw new Error("I don't know what this rotation even is.", r);

  return `${degs(euler.x)} ${degs(euler.y)} ${degs(euler.z)}`;
};

export function instantiate(o) {
  if (typeof o === "string") {
    const el = document.createElement("container");
    el.innerHTML = o;
    return el.firstElementChild;
  }
  throw new Error("Can only instantiate from string for now.");
};

export function instantiateDatagroup(dg, el = document.createElement('a-entity')) {
  // Create child datagroups as child entities of 'el'.
  for (const dgName in dg.datagroups)
    instantiateDatagroup(dg.datagroups[dgName], el);
  // Add this elements attributes. Simple scalar attribues such as class or position can be combined under a
  // single 'attributes' dataset. Complex attributes/components such as geometry are defined as a separate
  // dataset.
  for (const dsName in dg.datasets) {
    const ds = dg.datasets[dsName]; const oData = ds.getData();
    if (dsName === 'attributes') {
      for (const name in oData)
        el.setAttribute(name, oData[name]);
      continue;
    }
    ds.system.setAttribute(el, dsName, oData);
  }
  return el;
}

export function isVisibleInScene(el) {
  let iter = el.isObject3D ? el : el.object3D;
  while (iter !== null) {
    if (!iter.visible)
      return false;
    iter = iter.parent;
  }
  return true;
}

export function createSchemaPersistentObject(comp, data, ...props) {
  const ao = [];
  const newProps = {};
  props.forEach(prop => {
    var o = data[prop];
    if (!o) { o = {}; newProps[prop] = { default: o, parse() { return o }, stringify() { JSON.stringify(o) } } };
    ao.push(o);
  });
  comp.extendSchema(newProps);
  return ao.length === 1 ? ao[0] : ao;
}

// Gets back the component data, forcing aframe to initialise the component if necessary.
export function getComponentData(el, compName) {
  const data = el.getAttribute(compName);
  if (!data)
    return undefined;
  if (typeof data === 'object')
    return data;
  el.setAttribute(compName, data);
  return el.components[compName].data;
}

export function randomiseVector(v, length) {
  v.setX(Math.random() * 2 - 1);
  v.setY(Math.random() * 2 - 1);
  v.setZ(Math.random() * 2 - 1);
  v.normalize();
  if (length)
    v.setLength(length)
  return v;
}
