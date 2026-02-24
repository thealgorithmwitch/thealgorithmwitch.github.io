const starContainer = document.getElementById("star-container");
const starCount = 120;

for (let i = 0; i < starCount; i++) {
  const star = document.createElement("div");
  star.classList.add("star");

  const x = Math.random() * 100;
  const y = Math.random() * 100;
  const duration = 2 + Math.random() * 4;
  const delay = Math.random() * 5;
  const size = Math.random() < 0.1 ? 3 : 1;
  const opacity = 0.2 + Math.random() * 0.6;

  star.style.left = `${x}%`;
  star.style.top = `${y}%`;
  star.style.width = `${size}px`;
  star.style.height = `${size}px`;
  star.style.setProperty("--duration", `${duration}s`);
  star.style.setProperty("--delay", `${delay}s`);
  star.style.setProperty("--opacity", opacity);

  starContainer.appendChild(star);
}
