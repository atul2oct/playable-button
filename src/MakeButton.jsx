
import { useState } from "react";
import "./MakeButton.css";

export default function MakeButton() {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const dodgeButton = () => {
    setPosition({
      x: Math.random() * 240 - 120,
      y: Math.random() * 140 - 70,
    });
  };

  return (
    <div className="button-area">
      <button
        type="button"
        className="make-button"
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        onMouseEnter={dodgeButton}
        onMouseDown={(e) => e.preventDefault()}
        onTouchStart={(e) => {
          e.preventDefault();
          dodgeButton();
        }}
      >
        Make Button
      </button>
    </div>
  );
}