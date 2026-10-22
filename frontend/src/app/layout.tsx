import { publicManagedSettings } from './lib/managedSignInSettings';
import type { Metadata } from "next";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
 title: 'Legal Assistant', description: 'Review documents, research case law and prepare legal work.',
 icons: { icon: '/icon.svg' },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body
                className="font-sans antialiased"
            >
                {process.env.PRAMAAN_CONFIGURED === "" && <p role="status" className="p-4 text-center">Add PRAMAAN_API_KEY to .env</p>}
                <script id="managed-auth-config" type="application/json" dangerouslySetInnerHTML={{__html:JSON.stringify(publicManagedSettings()).replace(/</g,"\\u003c")}} />
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
