/**
 * Unit & Integration Verification Script for Navbar Search & Category Dropdown
 */
import fs from 'fs';
import path from 'path';

function runAssertions() {
  console.log('--- Verifying Workspace Navbar Search & Category Dropdown ---');

  // 1. Verify navbar-search.tsx exists
  const searchComponentPath = path.resolve(__dirname, '../components/layout/navbar-search.tsx');
  if (!fs.existsSync(searchComponentPath)) {
    throw new Error('Missing components/layout/navbar-search.tsx');
  }
  const searchSource = fs.readFileSync(searchComponentPath, 'utf8');

  // Check required elements in searchSource
  const requiredSearchPatterns = [
    { pattern: /placeholder="Search"/, name: 'Search placeholder "Search"' },
    { pattern: /role="search"/, name: 'Search form role' },
    { pattern: /aria-haspopup="listbox"/, name: 'Category button aria-haspopup="listbox"' },
    { pattern: /aria-expanded={isOpen}/, name: 'Category button aria-expanded state' },
    { pattern: /role="listbox"/, name: 'Dropdown role="listbox"' },
    { pattern: /role="option"/, name: 'Options role="option"' },
    { pattern: /aria-selected={isSelected}/, name: 'Option aria-selected state' },
    { pattern: /Talent/, name: 'Contains Talent option' },
    { pattern: /Jobs/, name: 'Contains Jobs option' },
    { pattern: /useState<SearchCategory>\('Talent'\)/, name: 'Default category is Talent' },
    { pattern: /Escape/, name: 'Escape key handling' },
    { pattern: /ArrowDown/, name: 'ArrowDown key handling' },
    { pattern: /ArrowUp/, name: 'ArrowUp key handling' },
    { pattern: /router\.push.*\/freelancers/, name: 'Redirects to /freelancers on Talent search' },
    { pattern: /router\.push.*\/jobs/, name: 'Redirects to /jobs on Jobs search' },
    { pattern: /rounded-full/, name: 'Pill-shaped rounded-full container' },
  ];

  for (const { pattern, name } of requiredSearchPatterns) {
    if (!pattern.test(searchSource)) {
      throw new Error(`Assertion failed: ${name}`);
    }
    console.log(`✓ ${name}`);
  }

  // 2. Verify navbar.tsx integration
  const navbarPath = path.resolve(__dirname, '../components/layout/navbar.tsx');
  const navbarSource = fs.readFileSync(navbarPath, 'utf8');

  const requiredNavbarPatterns = [
    { pattern: /import NavbarSearch from '@\/components\/layout\/navbar-search'/, name: 'NavbarSearch imported in navbar.tsx' },
    { pattern: /<NavbarSearch className="hidden sm:block/, name: 'Desktop/tablet NavbarSearch rendered' },
    { pattern: /mobileSearchOpen/, name: 'Mobile search toggle state' },
    { pattern: /<NavbarSearch[\s\S]*?className="w-full"/, name: 'Mobile drawer/expandable search rendered' },
    { pattern: /Log in/, name: 'Preserved Log in action' },
    { pattern: /Sign up/, name: 'Preserved Sign up action' },
    { pattern: /Hire talent/, name: 'Preserved Hire talent navigation' },
    { pattern: /Find work/, name: 'Preserved Find work navigation' },
    { pattern: /Why Workspace/, name: 'Preserved Why Workspace navigation' },
  ];

  for (const { pattern, name } of requiredNavbarPatterns) {
    if (!pattern.test(navbarSource)) {
      throw new Error(`Assertion failed: ${name}`);
    }
    console.log(`✓ ${name}`);
  }

  // 3. Verify freelancers page supports search parameter 'q'
  const freelancersPagePath = path.resolve(__dirname, '../app/freelancers/page.tsx');
  const freelancersSource = fs.readFileSync(freelancersPagePath, 'utf8');

  if (!/useSearchParams/.test(freelancersSource) || !/searchParams\.get\('q'\)/.test(freelancersSource)) {
    throw new Error('Assertion failed: app/freelancers/page.tsx does not read "q" search param');
  }
  console.log('✓ app/freelancers/page.tsx reads "q" search parameter');

  // 4. Verify jobs page supports search parameter 'q'
  const jobsPagePath = path.resolve(__dirname, '../app/jobs/page.tsx');
  const jobsSource = fs.readFileSync(jobsPagePath, 'utf8');

  if (!/useSearchParams/.test(jobsSource) || !/searchParams\.get\('q'\)/.test(jobsSource)) {
    throw new Error('Assertion failed: app/jobs/page.tsx does not read "q" search param');
  }
  console.log('✓ app/jobs/page.tsx reads "q" search parameter');

  console.log('\nAll Navbar Search assertions passed successfully!');
}

runAssertions();

