import {profileStorageKey} from './binance-profile';
function scopedStorage(kind:'localStorage'|'sessionStorage'){
 return {getItem:(key:string)=>window[kind].getItem(profileStorageKey(key)),setItem:(key:string,value:string)=>window[kind].setItem(profileStorageKey(key),value),removeItem:(key:string)=>window[kind].removeItem(profileStorageKey(key))};
}
export const profileLocalStorage=scopedStorage('localStorage');
export const profileSessionStorage=scopedStorage('sessionStorage');
