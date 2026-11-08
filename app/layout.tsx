import type {Metadata} from 'next';
import './globals.css';
import './brutalist.css';
export const metadata:Metadata={title:'LeakLoop — Campus water intelligence',description:'Local simulation of evidence-led campus water investigations.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
