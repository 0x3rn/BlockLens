import { useEffect } from 'react';

export const usePageMeta = (title: string, description: string) => {
  useEffect(() => {
    document.title = `${title} · BlockLens`;
    const descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    const ogDescription = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    const twitterTitle = document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]');
    if (descriptionMeta) descriptionMeta.content = description;
    if (ogTitle) ogTitle.content = `${title} · BlockLens`;
    if (ogDescription) ogDescription.content = description;
    if (twitterTitle) twitterTitle.content = `${title} · BlockLens`;
    if (twitterDescription) twitterDescription.content = description;
  }, [description, title]);
};
