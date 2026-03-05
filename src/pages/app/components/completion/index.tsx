import { useCompletion } from "@/hooks";
import { Screenshot } from "./Screenshot";
import { SystemAudioDaemonToggle } from "./SystemAudioDaemonToggle";
import { Files } from "./Files";
import { Audio } from "./Audio";
import { Input } from "./Input";

export const Completion = ({ isHidden }: { isHidden: boolean }) => {
  const completion = useCompletion();

  return (
    <>
      <Audio {...completion} />
      <Input {...completion} isHidden={isHidden} />
      <Screenshot {...completion} />
      <SystemAudioDaemonToggle />
      <Files {...completion} />
    </>
  );
};
