'use client';
import {realHistoryView,type RealHistoryRow} from '../../lib/real-history-view';
import {summarizeOpenPnl,type OpenPnlPosition} from '../../lib/floating-pnl';
import {santiagoDayStart} from '../../lib/pnl-period';
import {TodayProfit} from './today-profit';
import {FloatingAccount} from './floating-account';
export function RealHistoryProfit({historyStart,rows,positions,floating,accountKey,accountName,updatedAt,pnlUpdatedAt,error,now,onViewBtc}:{onViewBtc?:()=>void;historyStart?:number|null;rows:RealHistoryRow[]|null|undefined;positions?:OpenPnlPosition[];floating:number|null;accountKey:string;accountName:string;updatedAt?:number;pnlUpdatedAt?:number;error?:string;now:number}){
 const history=realHistoryView(rows,santiagoDayStart(now),historyStart),summary=summarizeOpenPnl(positions),readAt=pnlUpdatedAt??updatedAt;
 const stale=!!error||!readAt||now-readAt>90000;
 const note=`${history.count===null?'Historial pendiente':history.count+' cierres del Historial real'}. Hoy y Total suman la columna Resultado realizado, antes de comisiones y financiación. Flotante: posiciones abiertas de esta cuenta.`;
 const data={today:history.today,total:history.total,floating,count:summary.count,best:summary.best,stale,label:accountName+' · P&L',note};
 return <><TodayProfit onViewBtc={onViewBtc} retainLast today={history.total} accountKey={accountKey} updatedAt={readAt} now={now} error={error} widgetData={data} scopeKey={`real-history-notice-v4:${historyStart??'pending'}`} label="Swing Inversa · realizado"/><FloatingAccount today={history.today} total={history.total} floating={floating} positions={positions} accountKey={accountKey} updatedAt={updatedAt} pnlUpdatedAt={pnlUpdatedAt} now={now} pnlError={error} label={data.label} note={note}/></>;
}
