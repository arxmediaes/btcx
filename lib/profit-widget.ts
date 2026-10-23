type PictureWindowApi={window?:Window;requestWindow:(options:{width:number;height:number})=>Promise<Window>};
export function profitWidgetApi():PictureWindowApi|undefined{
 if(typeof window==='undefined')return undefined;
 return (window as Window&{documentPictureInPicture?:PictureWindowApi}).documentPictureInPicture;
}
export function profitWidgetOpen(){const widget=profitWidgetApi()?.window;return !!widget&&!widget.closed}
export async function openProfitWidget(){
 const api=profitWidgetApi();if(!api)throw Error('Este navegador no permite una ventana flotante. Puedes usar la vista ampliada.');
 return api.requestWindow({width:320,height:300});
}
