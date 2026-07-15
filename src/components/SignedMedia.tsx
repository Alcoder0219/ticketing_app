import { useSignedUrl } from "@/lib/storage";

interface Props extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  bucket?: string;
}

export function SignedImage({ src, bucket, ...rest }: Props) {
  const signed = useSignedUrl(src, bucket);
  return <img {...rest} src={signed || src} />;
}

interface AudioProps extends React.AudioHTMLAttributes<HTMLAudioElement> {
  src: string;
  bucket?: string;
}

export function SignedAudio({ src, bucket, ...rest }: AudioProps) {
  const signed = useSignedUrl(src, bucket);
  return <audio {...rest} src={signed || src} />;
}

export function SignedLink({
  href,
  bucket,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; bucket?: string }) {
  const signed = useSignedUrl(href, bucket);
  return (
    <a {...rest} href={signed || href} target={rest.target ?? "_blank"} rel={rest.rel ?? "noreferrer"}>
      {children}
    </a>
  );
}
