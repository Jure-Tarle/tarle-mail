"use client";

import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Scroll choreography for the landing page. Each motion explains something: the mark arrives first,
 * the product shot straightens up as it comes into view, chapters reveal in reading order.
 * Under prefers-reduced-motion nothing moves and every element stays in its final state.
 */
export function LandingMotion() {
	useEffect(() => {
		gsap.registerPlugin(ScrollTrigger);
		const media = gsap.matchMedia();

		media.add("(prefers-reduced-motion: no-preference)", () => {
			const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
			intro
				.from("[data-hero-mark]", { y: 48, scale: 0.82, rotate: -6, opacity: 0, duration: 1.1 })
				.from("[data-hero-line]", { y: 28, opacity: 0, duration: 0.8, stagger: 0.1 }, "-=0.7");

			gsap.fromTo(
				"[data-product-shot]",
				{ rotateX: 24, scale: 0.86, y: 40, transformPerspective: 1600, transformOrigin: "50% 0%" },
				{ rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: "[data-product-stage]", start: "top 85%", end: "top 20%", scrub: 0.6 } },
			);

			gsap.utils.toArray<HTMLElement>("[data-chapter]").forEach((chapter) => {
				const shot = chapter.querySelector("[data-chapter-shot]");
				const from = chapter.dataset.chapter === "left" ? -80 : 80;
				gsap.from(chapter.querySelectorAll("[data-reveal]"), {
					y: 36,
					opacity: 0,
					duration: 0.9,
					ease: "power3.out",
					stagger: 0.08,
					scrollTrigger: { trigger: chapter, start: "top 75%" },
				});
				if (shot) {
					gsap.from(shot, { x: from, opacity: 0, ease: "none", scrollTrigger: { trigger: chapter, start: "top 85%", end: "top 35%", scrub: 0.6 } });
				}
			});

			gsap.from("[data-fact]", {
				y: 24,
				opacity: 0,
				duration: 0.7,
				ease: "power2.out",
				stagger: 0.12,
				scrollTrigger: { trigger: "[data-facts]", start: "top 80%" },
			});
		});

		return () => media.revert();
	}, []);

	return null;
}
