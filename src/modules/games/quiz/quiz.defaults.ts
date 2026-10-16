// Seed question bank. The first option is the right answer; options are
// shuffled when seeding so the correct index varies.
export const DEFAULT_QUESTIONS: Array<{
  question: string
  options: [string, string, string, string]
  category: string
  difficulty: "easy" | "medium" | "hard"
}> = [
  { question: "En quelle année le Barça a-t-il été fondé ?", options: ["1899", "1902", "1910", "1889"], category: "histoire", difficulty: "easy" },
  { question: "Qui est le fondateur du Barça ?", options: ["Joan Gamper", "Johan Cruyff", "Josep Suñol", "Santiago Bernabéu"], category: "histoire", difficulty: "easy" },
  { question: "Quelle est la devise du club ?", options: ["Més que un club", "Visca el Barça", "Força Barça", "Sempre amunt"], category: "histoire", difficulty: "easy" },
  { question: "Comment surnomme-t-on les supporters du Barça ?", options: ["Les Culés", "Les Merengues", "Les Colchoneros", "Les Che"], category: "histoire", difficulty: "easy" },
  { question: "Comment s'appelle le centre de formation du Barça ?", options: ["La Masia", "La Fábrica", "Lezama", "Paterna"], category: "histoire", difficulty: "easy" },
  { question: "Combien de Ligues des champions le Barça a-t-il gagnées entre 1992 et 2015 ?", options: ["5", "3", "4", "6"], category: "trophées", difficulty: "medium" },
  { question: "Contre quel club le Barça a-t-il remporté sa première Coupe d'Europe des clubs champions en 1992 ?", options: ["Sampdoria", "Benfica", "Steaua Bucarest", "Marseille"], category: "trophées", difficulty: "medium" },
  { question: "Qui a marqué le but victorieux de la finale de 1992 à Wembley ?", options: ["Ronald Koeman", "Hristo Stoitchkov", "Michael Laudrup", "Pep Guardiola"], category: "trophées", difficulty: "hard" },
  { question: "Quel entraîneur a mené le Barça au sextuplé en 2009 ?", options: ["Pep Guardiola", "Frank Rijkaard", "Luis Enrique", "Tito Vilanova"], category: "entraîneurs", difficulty: "easy" },
  { question: "Qui est le meilleur buteur de l'histoire du Barça ?", options: ["Lionel Messi", "César Rodríguez", "László Kubala", "Luis Suárez"], category: "joueurs", difficulty: "easy" },
  { question: "Quel joueur du Barça a remporté le Ballon d'Or 2010 ?", options: ["Lionel Messi", "Andrés Iniesta", "Xavi Hernández", "David Villa"], category: "joueurs", difficulty: "medium" },
  { question: "Contre quel club le Barça a-t-il gagné la finale de Ligue des champions 2009 à Rome ?", options: ["Manchester United", "Chelsea", "Arsenal", "Juventus"], category: "trophées", difficulty: "medium" },
  { question: "Contre quel club le Barça a-t-il remporté la finale de Ligue des champions 2015 à Berlin ?", options: ["Juventus", "Bayern Munich", "Manchester United", "Arsenal"], category: "trophées", difficulty: "medium" },
  { question: "Contre quel club le Barça a-t-il remporté la finale de Ligue des champions 2006 au Stade de France ?", options: ["Arsenal", "AC Milan", "Liverpool", "Valence"], category: "trophées", difficulty: "medium" },
  { question: "Contre quel club le Barça a-t-il remporté la finale de Ligue des champions 2011 à Wembley ?", options: ["Manchester United", "Chelsea", "Bayern Munich", "Inter Milan"], category: "trophées", difficulty: "medium" },
  { question: "Le trio « MSN » était composé de Messi, Suárez et…", options: ["Neymar", "Pedro", "David Villa", "Antoine Griezmann"], category: "joueurs", difficulty: "easy" },
  { question: "Comment appelle-t-on le match entre le Barça et le Real Madrid ?", options: ["El Clásico", "Le derby catalan", "Le derby de la Liga", "El Superclásico"], category: "histoire", difficulty: "easy" },
  { question: "Quel club le Barça affronte-t-il dans le derby de Barcelone ?", options: ["Espanyol", "Girona", "Gimnàstic", "Sabadell"], category: "histoire", difficulty: "easy" },
  { question: "Quel tournoi amical le Barça organise-t-il chaque été ?", options: ["Trophée Joan Gamper", "Trophée Santiago Bernabéu", "Trophée Teresa Herrera", "Trophée Ramón de Carranza"], category: "histoire", difficulty: "medium" },
  { question: "Quelles sont les couleurs du Barça ?", options: ["Bleu et grenat", "Bleu et blanc", "Rouge et jaune", "Bleu et jaune"], category: "histoire", difficulty: "easy" },
  { question: "De quel club Ronaldinho est-il arrivé au Barça en 2003 ?", options: ["Paris Saint-Germain", "Grêmio", "AC Milan", "Flamengo"], category: "joueurs", difficulty: "medium" },
  { question: "Lors de la « remontada » face au PSG en 2017, quel a été le score du match retour au Camp Nou ?", options: ["6-1", "4-0", "5-1", "6-2"], category: "matchs", difficulty: "medium" },
  { question: "Qui a marqué le 6e but de la remontada contre le PSG en 2017 ?", options: ["Sergi Roberto", "Neymar", "Luis Suárez", "Lionel Messi"], category: "matchs", difficulty: "hard" },
  { question: "Quel numéro portait Andrés Iniesta au Barça ?", options: ["8", "6", "10", "14"], category: "joueurs", difficulty: "medium" },
  { question: "Quel numéro portait Xavi Hernández au Barça ?", options: ["6", "8", "4", "5"], category: "joueurs", difficulty: "medium" },
  { question: "Combien de Coupes du monde des clubs FIFA le Barça a-t-il remportées ?", options: ["3", "2", "4", "1"], category: "trophées", difficulty: "hard" },
  { question: "Quel légendaire Néerlandais a entraîné la « Dream Team » du Barça ?", options: ["Johan Cruyff", "Louis van Gaal", "Frank Rijkaard", "Ronald Koeman"], category: "entraîneurs", difficulty: "easy" },
  { question: "Quel Bulgare était l'une des stars de la Dream Team de Cruyff ?", options: ["Hristo Stoitchkov", "Dimitar Berbatov", "Krasimir Balakov", "Yordan Letchkov"], category: "joueurs", difficulty: "hard" },
  { question: "En quelle année Lionel Messi a-t-il fait ses débuts officiels avec l'équipe première ?", options: ["2004", "2002", "2006", "2005"], category: "joueurs", difficulty: "medium" },
  { question: "Quelle saison le Barça a-t-il remporté la toute première édition de la Liga ?", options: ["1928-29", "1931-32", "1945-46", "1952-53"], category: "trophées", difficulty: "hard" },
  { question: "Quel entraîneur allemand dirige le Barça depuis la saison 2024-25 ?", options: ["Hansi Flick", "Jürgen Klopp", "Thomas Tuchel", "Julian Nagelsmann"], category: "entraîneurs", difficulty: "easy" },
  { question: "Avant sa rénovation, quelle était la capacité approximative du Camp Nou ?", options: ["Environ 99 000 places", "Environ 75 000 places", "Environ 120 000 places", "Environ 85 000 places"], category: "stade", difficulty: "medium" },
  { question: "Dans quel district de Barcelone se trouve le Camp Nou ?", options: ["Les Corts", "Gràcia", "Sants", "Eixample"], category: "stade", difficulty: "hard" },
  { question: "Quel joueur formé à La Masia est devenu le plus jeune buteur de l'histoire de l'Euro en 2024 ?", options: ["Lamine Yamal", "Gavi", "Pau Cubarsí", "Fermín López"], category: "joueurs", difficulty: "easy" },
  { question: "Quel est l'hymne officiel du Barça ?", options: ["Cant del Barça", "Els Segadors", "Himno de la Liga", "La Santa Espina"], category: "histoire", difficulty: "medium" },
]
