declare module 'mammoth/mammoth.browser.min.js' {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
  };
  export default mammoth;
}

declare module 'foliate-js/mobi.js' {
  export interface MobiSection {
    id: number;
    load(): Promise<unknown>;
    createDocument(): Promise<Document>;
    size: number;
  }
  export interface MobiTocItem {
    label: string;
    href: string;
  }
  export interface MobiBook {
    metadata: { title: string; author?: string[] | string; language?: string };
    sections: MobiSection[];
    toc?: MobiTocItem[];
    getCover?: () => Promise<Blob | undefined>;
    resolveHref?: (href: string) => { index: number };
  }
  export const isMOBI: (file: Blob) => Promise<boolean>;
  export class MOBI {
    constructor(opts: { unzlib: (data: Uint8Array) => Promise<Uint8Array> });
    open(file: Blob): Promise<MobiBook>;
  }
}
