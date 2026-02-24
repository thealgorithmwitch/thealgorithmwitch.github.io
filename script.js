// Create starfield
const starContainer = document.getElementById('star-container');
const starCount = 150;

for (let i = 0; i < starCount; i++) {
    const star = document.createElement('div');
    star.classList.add('star');
    
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    const duration = 2 + Math.random() * 4;
    const delay = Math.random() * 5;
    const size = Math.random() < 0.1 ? 3 : (Math.random() < 0.4 ? 2 : 1);
    const opacity = 0.2 + Math.random() * 0.6;
    
    star.style.left = `${x}%`;
    star.style.top = `${y}%`;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.setProperty('--duration', `${duration}s`);
    star.style.setProperty('--delay', `${delay}s`);
    star.style.setProperty('--opacity', opacity);
    
    starContainer.appendChild(star);
}

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    const navInner = navbar.querySelector('.glass-panel');
    
    if (window.scrollY > 50) {
        navbar.classList.add('py-2');
        navbar.classList.remove('py-6');
        navInner.classList.add('bg-[#050214]/90');
    } else {
        navbar.classList.add('py-6');
        navbar.classList.remove('py-2');
        navInner.classList.remove('bg-[#050214]/90');
    }
});

// Reveal animation on scroll
const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px"
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.reveal').forEach(element => {
    observer.observe(element);
});
