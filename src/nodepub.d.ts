declare module "nodepub" {
    export type Metadata = {
        id: string,
        cover: string,
        title: string,
        series?: string,
        sequence?: number,
        author: string,
        fileAs?: string,
        genre: string,
        tags?: string,
        copyright: string,
        publisher?: string,
        published?: string,
        language?: string,
        description?: string,
        contents?: string,
        source?: string,
        images?: string,
    };

    export type Link = {
        title: string,
        link: string,
        itemType: "front" | "contents" | "main",
    };

    export type MakeContents = (links: Link[]) => string;

    export function document(metadata: Metadata, makeContentsPage?: MakeContents): EPub;

    export class EPub {
        // toc should be false, true
        addSection(title: string, html: string, exclude_from_toc?: boolean, use_as_front_matter?: boolean): void;
        addCSS(css: string): void;
        writeEPUB(directory: string, filename_excl_extn: string): Promise<void>;
    }
}