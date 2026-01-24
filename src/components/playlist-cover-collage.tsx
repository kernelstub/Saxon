import { memo } from "react"
import { cn } from "@/lib/utils"

export const PlaylistCoverCollage = memo(function PlaylistCoverCollage({
  coverUrls,
  className,
}: {
  coverUrls: Array<string | null | undefined>
  className?: string
}) {
  const urls = coverUrls.slice(0, 4)
  while (urls.length < 4) urls.push(null)

  return (
    <div className={cn("grid grid-cols-2 grid-rows-2 gap-px bg-muted w-full h-full", className)}>
      {urls.map((url, index) => (
        <div key={index} className="relative overflow-hidden bg-secondary">
          <img
            src={url || "/icon.png"}
            alt={`Playlist cover ${index + 1}`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        </div>
      ))}
    </div>
  )
})
