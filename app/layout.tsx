import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Hyrule — Trading Lab',description:'Observa el mercado. Prueba tu estrategia. Aprende de cada operación.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body>{children}</body></html>}
