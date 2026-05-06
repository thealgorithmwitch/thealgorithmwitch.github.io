# Elemental Impact Targeted Audit

## Affected Records
- elemental-impact-95090d1a6bc6 | Software Engineer Lead | Shifted Energy | ./pages/software-engineer-lead-shifted-energy.html | https://apply.workable.com/resource-innovations/j/DD39335D06

## Parser Failure
- Elemental Impact attribution was allowing noisy body text and taxonomy blobs to influence organization identity.
- Workable apply URL context and clean board-card organization were not protected strongly enough, so Shifted Energy body text leaked into Resource Innovations publishing.

## Temporary Fallback
- For Elemental Impact, clean board-default title and organization now win.
- Description/body metadata is no longer used to infer company.
- Ambiguous Elemental Impact organization cases route to pending/manual review instead of auto-publishing corrupted identity.

## Before After
### elemental-impact-446c301b54b2
```json
{
  "id": "elemental-impact-446c301b54b2",
  "before": {
    "jobs": {
      "id": "elemental-impact-446c301b54b2",
      "title": "Senior Software Engineer",
      "organization": "Resource Innovations",
      "location": "US - Multiple Locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$144,000 / year",
      "page_url": "./pages/senior-software-engineer-resource-innovations.html",
      "redirect_paths": [
        "./pages/senior-software-engineer-shifted-energy.html"
      ],
      "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
      "description_snippet": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "summary": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    },
    "job_record": {
      "id": "elemental-impact-446c301b54b2",
      "display": {
        "title": "Senior Software Engineer",
        "organization": "Resource Innovations",
        "location": "US - Multiple Locations",
        "location_type": "Remote",
        "pay_display": "$100,000–$144,000 / year",
        "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
        "page_url_override": "./pages/senior-software-engineer-resource-innovations.html",
        "application_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
        "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36"
      },
      "raw_source_data": {
        "title": "Senior Software Engineer",
        "organization": "Resource Innovations",
        "location": "US - Multiple Locations",
        "workplace_type": "Remote",
        "salary": "$100,000–$144,000 / year",
        "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
        "page_url_override": "./pages/senior-software-engineer-resource-innovations.html",
        "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
        "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36"
      }
    },
    "oldjobs": {
      "id": "elemental-impact-446c301b54b2",
      "title": "Senior Software Engineer",
      "organization": "Resource Innovations",
      "location": "US - Multiple Locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$144,000 / year",
      "page_url": "./pages/senior-software-engineer-resource-innovations.html",
      "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship Resource Innovations is seeking to join our growing Software as a Service (. Resource Innovations is seeking to join our growing Software as a Service (.",
      "description_snippet": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "summary": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    }
  },
  "after": {
    "jobs": {
      "id": "elemental-impact-446c301b54b2",
      "title": "Senior Software Engineer",
      "organization": "Resource Innovations",
      "location": "US - Multiple Locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$144,000 / year",
      "page_url": "./pages/senior-software-engineer-resource-innovations.html",
      "redirect_paths": [
        "./pages/senior-software-engineer-shifted-energy.html"
      ],
      "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
      "description_snippet": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "summary": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    },
    "job_record": {
      "id": "elemental-impact-446c301b54b2",
      "display": {
        "title": "Senior Software Engineer",
        "organization": "Resource Innovations",
        "location": "US - Multiple Locations",
        "location_type": "Remote",
        "pay_display": "$100,000–$144,000 / year",
        "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
        "page_url_override": "./pages/senior-software-engineer-resource-innovations.html",
        "application_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
        "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36"
      },
      "raw_source_data": {
        "title": "Senior Software Engineer",
        "organization": "Resource Innovations",
        "location": "US - Multiple Locations",
        "workplace_type": "Remote",
        "salary": "$100,000–$144,000 / year",
        "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
        "page_url_override": "./pages/senior-software-engineer-resource-innovations.html",
        "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
        "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36"
      }
    },
    "oldjobs": {
      "id": "elemental-impact-446c301b54b2",
      "title": "Senior Software Engineer",
      "organization": "Resource Innovations",
      "location": "US - Multiple Locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$144,000 / year",
      "page_url": "./pages/senior-software-engineer-resource-innovations.html",
      "description": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team. As a hands-on technical lead at Resource Innovations, you will be instrumental in the design, development and deployment of innovative cloud-based enterprise software used by leading Energy organizations. We are looking for candidates who want to work on things that make an impact on the world and are passionate about product craftsmanship.",
      "description_snippet": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "summary": "Resource Innovations is seeking to join our growing Software as a Service (SaaS) team.",
      "apply_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "original_url": "https://apply.workable.com/resource-innovations/j/68FA4D2A36",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    }
  }
}
```
### elemental-impact-95090d1a6bc6
```json
{
  "id": "elemental-impact-95090d1a6bc6",
  "before": {
    "jobs": {
      "id": "elemental-impact-95090d1a6bc6",
      "title": "Software Engineer Lead",
      "organization": "Shifted Energy",
      "location": "US - Multiple locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$135,000",
      "page_url": "./pages/software-engineer-lead-shifted-energy.html",
      "redirect_paths": [],
      "description": "Shifted Energy other 2 Business/Productivity Software Cleantech Consumer Electronics Data Storage Electronics Energy Energy Storage Hardware Hardware Peripherals IT Services and IT Consulting Machine Learning Oil & Gas Other Energy Services Other Equipment Physical Security Physical Storage Platform Renewable Energy Renewables & Environment Security Solar Power Storage Sustainability Sustainability Technology Wind Power shifted-energy Chicago, IL, USA Cook County, IL, USA Illinois, USA United States North America 0 career_page on_site CakePHP Laravel Vue.js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA locality POINT (-87.6297982 41.8781136) USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy la…",
      "description_snippet": "",
      "summary": "",
      "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    },
    "job_record": {
      "id": "elemental-impact-95090d1a6bc6",
      "display": {
        "title": "Software Engineer Lead",
        "organization": "Shifted Energy",
        "location": "Remote",
        "location_type": "Remote",
        "pay_display": "$100,000–$135,000 / year",
        "description": "This position is listed in Remote and a remote role",
        "page_url_override": "",
        "application_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
        "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06"
      },
      "raw_source_data": {
        "title": "Software Engineer Lead",
        "organization": "Shifted Energy",
        "location": "Remote",
        "workplace_type": "Remote",
        "salary": "$100,000–$135,000 / year",
        "description": "This position is listed in Remote and a remote role",
        "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
        "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06"
      }
    },
    "oldjobs": {
      "id": "elemental-impact-95090d1a6bc6",
      "title": "Software Engineer Lead",
      "organization": "Resource Innovations",
      "location": "US - Multiple locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$135,000",
      "page_url": "./pages/software-engineer-lead-shifted-energy.html",
      "description": "Shifted Energy other 2 Business/Productivity Software Cleantech Consumer Electronics Data Storage Electronics Energy Energy Storage Hardware Hardware Peripherals IT Services and IT Consulting Machine Learning Oil & Gas Other Energy Services Other Equipment Physical Security Physical Storage Platform Renewable Energy Renewables & Environment Security Solar Power Storage Sustainability Sustainability Technology Wind Power shifted-energy Chicago, IL, USA Cook County, IL, USA Illinois, USA United States North America 0 career_page on_site CakePHP Laravel Vue.js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA locality POINT (-87.6297982 41.8781136) USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA - senior Software Engineer Lead Shifted Energy latform. js Tailwind CSS RESTful API Single Page Application Agile Methodology Data Science Problem Solving Chicago, IL, USA USD year Chicago, IL, USA -software-engineer-lead senior Shifted Energy la…",
      "description_snippet": "",
      "summary": "",
      "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    }
  },
  "after": {
    "jobs": {
      "id": "elemental-impact-95090d1a6bc6",
      "title": "Software Engineer Lead",
      "organization": "Resource Innovations",
      "location": "US - Multiple locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$135,000",
      "page_url": "./pages/software-engineer-lead-resource-innovations.html",
      "redirect_paths": [
        "./pages/software-engineer-lead-shifted-energy.html"
      ],
      "description": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives.",
      "description_snippet": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives",
      "summary": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives",
      "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    },
    "job_record": {
      "id": "elemental-impact-95090d1a6bc6",
      "display": {
        "title": "Software Engineer Lead",
        "organization": "Resource Innovations",
        "location": "US - Multiple locations",
        "location_type": "Remote",
        "pay_display": "$100,000–$135,000 / year",
        "description": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives.",
        "page_url_override": "./pages/software-engineer-lead-resource-innovations.html",
        "application_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
        "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06"
      },
      "raw_source_data": {
        "title": "Software Engineer Lead",
        "organization": "Resource Innovations",
        "location": "US - Multiple locations",
        "workplace_type": "Remote",
        "salary": "$100,000–$135,000 / year",
        "description": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives.",
        "page_url_override": "./pages/software-engineer-lead-resource-innovations.html",
        "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
        "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06"
      }
    },
    "oldjobs": {
      "id": "elemental-impact-95090d1a6bc6",
      "title": "Software Engineer Lead",
      "organization": "Resource Innovations",
      "location": "US - Multiple locations",
      "workplace_type": "Remote",
      "salary": "$100,000–$135,000",
      "page_url": "./pages/software-engineer-lead-resource-innovations.html",
      "description": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives.",
      "description_snippet": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives",
      "summary": "Leads software engineering for Resource Innovations’ customer-facing energy software and platform initiatives",
      "apply_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "original_url": "https://apply.workable.com/resource-innovations/j/DD39335D06",
      "triage_bucket": "review_ready",
      "triage_reason": "meets review-ready threshold",
      "status": "published"
    }
  }
}
```

## Files Changed
- scripts/source-rules.js
- scripts/validate-public-data.js
- scripts/test-normalizer.js
- scripts/targeted-elemental-impact-audit.js
- scripts/reconcile-public-data-resolutions.json
- jobs.json
- job-records.json
- oldjobs.json

## Validation
```json
{
  "hard_validation_failure_count": 0,
  "organization_page_url_conflict_count": 1,
  "public_record_organization_conflict_count": 1,
  "errors": [
    "organization/page_url mismatch count 1",
    "public-vs-record organization mismatch count 1"
  ],
  "hard_validation_failures": []
}
```
