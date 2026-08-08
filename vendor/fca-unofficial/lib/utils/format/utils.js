export function getType(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1);
}
export function formatID(id) {
  if (id !== undefined && id !== null) return id.replace(/(fb)?id[:.]/, "");
  return id;
}
export function padZeros(val, len = 2) {
  let out = String(val);
  while (out.length < len) out = "0" + out;
  return out;
}
export function arrayToObject(arr, getKey, getValue) {
  return arr.reduce((acc, val) => {
    acc[getKey(val)] = getValue(val);
    return acc;
  }, {});
}
export function arrToForm(form) {
  return arrayToObject(form, v => v.name, v => v.val);
}
export function getData_Path(Obj, Arr, Stt) {
  if (Arr.length === 0 && Obj !== undefined) {
    return Obj;
  }
  if (Obj === undefined) {
    return Stt;
  }
  const head = Arr[0];
  if (head === undefined) {
    return Stt;
  }
  const tail = Arr.slice(1);
  return getData_Path(Obj[head], tail, Stt++);
}
export function setData_Path(obj, path, value) {
  if (!path.length) {
    return obj;
  }
  const currentKey = path[0];
  let currentObj = obj[currentKey];
  if (!currentObj) {
    obj[currentKey] = value;
    currentObj = obj[currentKey];
  }
  path.shift();
  if (!path.length) {
    currentObj = value;
  } else {
    currentObj = setData_Path(currentObj, path, value);
  }
  return obj;
}
export function getPaths(obj, parentPath = []) {
  let paths = [];
  for (const prop in obj) {
    if (typeof obj[prop] === "object" && obj[prop] !== null) {
      paths = paths.concat(getPaths(obj[prop], [...parentPath, prop]));
    } else {
      paths.push([...parentPath, prop]);
    }
  }
  return paths;
}
export function cleanHTML(text) {
  let out = text;
  out = out.replace(/(<br>)|(<\/?i>)|(<\/?em>)|(<\/?b>)|(!?~)|(&amp;)|(&#039;)|(&lt;)|(&gt;)|(&quot;)/g, match => {
    switch (match) {
      case "<br>":
        return "\n";
      case "<i>":
      case "<em>":
      case "</i>":
      case "</em>":
        return "*";
      case "<b>":
      case "</b>":
        return "**";
      case "~!":
      case "!~":
        return "||";
      case "&amp;":
        return "&";
      case "&#039;":
        return "'";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      default:
        return match;
    }
  });
  return out;
}
export function getCurrentTimestamp() {
  return Date.now();
}
export function getSignatureID() {
  return Math.floor(Math.random() * 2147483648).toString(16);
}
export default {
  getType,
  formatID,
  padZeros,
  arrayToObject,
  arrToForm,
  getData_Path,
  setData_Path,
  getPaths,
  cleanHTML,
  getCurrentTimestamp,
  getSignatureID
};