import {crossLossStop} from './real-stop-plan';
export function dcaLevels(entry:number,quantity:number,price:number,added:number,side:1|-1,tick:number,target:number,isolatedStop?:number,noStop=false,lossBudget=.50){
 if(![entry,quantity,price,added,tick,target].every(Number.isFinite)||Math.min(entry,quantity,price,added,tick,target)<=0)throw Error('Datos de DCA incompletos.');
 if(side*(price-entry)>=0)throw Error('DCA disponible cuando el precio permite mejorar el promedio de una posición en negativo.');
 const total=quantity+added,average=(entry*quantity+price*added)/total,stop=noStop?0:isolatedStop||crossLossStop(average,total,side,tick,lossBudget);
 if((!noStop&&side*(price-stop)<=tick)||side*(target-average)<=tick)throw Error('El DCA no permite conservar un SL y TP válidos; revisa esta posición antes de añadir.');
 return {total,average,stop,target};
}
