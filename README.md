<style type="text/css">.rendered-markdown{font-size:14px} .rendered-markdown>*:first-child{margin-top:0!important} .rendered-markdown>*:last-child{margin-bottom:0!important} .rendered-markdown a{text-decoration:underline;color:#b75246} .rendered-markdown a:hover{color:#f36050} .rendered-markdown h1, .rendered-markdown h2, .rendered-markdown h3, .rendered-markdown h4, .rendered-markdown h5, .rendered-markdown h6{margin:24px 0 10px;padding:0;font-weight:bold;-webkit-font-smoothing:antialiased;cursor:text;position:relative} .rendered-markdown h1 tt, .rendered-markdown h1 code, .rendered-markdown h2 tt, .rendered-markdown h2 code, .rendered-markdown h3 tt, .rendered-markdown h3 code, .rendered-markdown h4 tt, .rendered-markdown h4 code, .rendered-markdown h5 tt, .rendered-markdown h5 code, .rendered-markdown h6 tt, .rendered-markdown h6 code{font-size:inherit} .rendered-markdown h1{font-size:28px;color:#000} .rendered-markdown h2{font-size:22px;border-bottom:1px solid #ccc;color:#000} .rendered-markdown h3{font-size:18px} .rendered-markdown h4{font-size:16px} .rendered-markdown h5{font-size:14px} .rendered-markdown h6{color:#777;font-size:14px} .rendered-markdown p, .rendered-markdown blockquote, .rendered-markdown ul, .rendered-markdown ol, .rendered-markdown dl, .rendered-markdown table, .rendered-markdown pre{margin:15px 0} .rendered-markdown hr{border:0 none;color:#ccc;height:4px;padding:0} .rendered-markdown>h2:first-child, .rendered-markdown>h1:first-child, .rendered-markdown>h1:first-child+h2, .rendered-markdown>h3:first-child, .rendered-markdown>h4:first-child, .rendered-markdown>h5:first-child, .rendered-markdown>h6:first-child{margin-top:0;padding-top:0} .rendered-markdown a:first-child h1, .rendered-markdown a:first-child h2, .rendered-markdown a:first-child h3, .rendered-markdown a:first-child h4, .rendered-markdown a:first-child h5, .rendered-markdown a:first-child h6{margin-top:0;padding-top:0} .rendered-markdown h1+p, .rendered-markdown h2+p, .rendered-markdown h3+p, .rendered-markdown h4+p, .rendered-markdown h5+p, .rendered-markdown h6+p{margin-top:0} .rendered-markdown ul, .rendered-markdown ol{padding-left:30px} .rendered-markdown ul li>:first-child, .rendered-markdown ul li ul:first-of-type, .rendered-markdown ol li>:first-child, .rendered-markdown ol li ul:first-of-type{margin-top:0} .rendered-markdown ul ul, .rendered-markdown ul ol, .rendered-markdown ol ol, .rendered-markdown ol ul{margin-bottom:0} .rendered-markdown dl{padding:0} .rendered-markdown dl dt{font-size:14px;font-weight:bold;font-style:italic;padding:0;margin:15px 0 5px} .rendered-markdown dl dt:first-child{padding:0} .rendered-markdown dl dt>:first-child{margin-top:0} .rendered-markdown dl dt>:last-child{margin-bottom:0} .rendered-markdown dl dd{margin:0 0 15px;padding:0 15px} .rendered-markdown dl dd>:first-child{margin-top:0} .rendered-markdown dl dd>:last-child{margin-bottom:0} .rendered-markdown blockquote{border-left:4px solid #DDD;padding:0 15px;color:#777} .rendered-markdown blockquote>:first-child{margin-top:0} .rendered-markdown blockquote>:last-child{margin-bottom:0} .rendered-markdown table th{font-weight:bold} .rendered-markdown table th, .rendered-markdown table td{border:1px solid #ccc;padding:6px 13px} .rendered-markdown table tr{border-top:1px solid #ccc;background-color:#fff} .rendered-markdown table tr:nth-child(2n){background-color:#f8f8f8} .rendered-markdown img{max-width:100%;-moz-box-sizing:border-box;box-sizing:border-box} .rendered-markdown code, .rendered-markdown tt{margin:0 2px;padding:0 5px;border:1px solid #eaeaea;background-color:#f8f8f8;border-radius:3px} .rendered-markdown code{white-space:nowrap} .rendered-markdown pre>code{margin:0;padding:0;white-space:pre;border:0;background:transparent} .rendered-markdown .highlight pre, .rendered-markdown pre{background-color:#f8f8f8;border:1px solid #ccc;font-size:13px;line-height:19px;overflow:auto;padding:6px 10px;border-radius:3px} .rendered-markdown pre code, .rendered-markdown pre tt{margin:0;padding:0;background-color:transparent;border:0}</style>
<div class="rendered-markdown"><h1>COMS W1004</h1>
<h2>Homework 8</h2>
<h2>Due April 4 at 11:59PM</h2>
<p>This assignment has a workload that is on the is on the heavy side. To reflect this difference, this assignment is worth 55 points and is posted three weeks before the due date so you can get started on it early.</p>
<p><strong>Submitting your work:</strong>
<br  />Please carefully read how to submit your work for this assignment. If you have questions please ask any member of the teaching staff. You will not earn full credit for work that is submitted incorrectly. Please be sure to check the course homework policy for more detailed information about homework submission and grading policies.</p>
<p>Once again we will be using Gradescope to submit your work. Please only submit your .java files (do not include .class files) and your <code>readMe.txt</code> file under Homework 8.</p>
<p><strong>Video Poker</strong>  (<em>adapted from Cay Horstmann's Big Java</em>)</p>
<p><strong><em>You must follow the instructions below to receive credit for this assignment.</em></strong></p>
<p>Implement a version of video poker. In this game we start with a full deck of 52 standard playing cards. Each card belongs to one of four suits: Clubs, Diamonds, Hearts, or Spades, and has a rank chosen from the set {2, 3, 4, 5, 6, 7, 8, 9, 10, Jack, Queen, King, Ace}. Before each game, the deck is shuffled and player bets 1-5 tokens. If a player bets <em>n</em> tokens and they win, (see below) they are paid <em>n</em> times the payout listed next to the hands below. To start the game the top five cards of the deck are presented to the player. These make up the player's <em>hand</em>. After receiving all five cards the player can choose to reject none, some, or all of the cards. After choosing which cards to accept and reject, the rejected cards are replaced by the cards at the top of the deck. Now the hand is evaluated. Your program should determine the hand to be one of the  following:</p>
<ul>
<li><strong>No pair</strong> - The lowest hand. Five separate cards that do not match up to create any of the hands listed below. Payout: 0 tokens. (player loses)</li>
<li><strong>One pair</strong> - Two cards of the same rank, for example two queens. Payout: 1 token. (player ties)</li>
<li><strong>Two pairs</strong> - Two pairs, for example two queens and two 5's. Payout: 2 tokens. (player wins)</li>
<li><strong>Three of a kind</strong> - Three cards of the same rank, for example three queens. Payout: 3 tokens. (player wins)</li>
<li><strong>Straight</strong> - Five cards with consecutive ranks, not necessarily of the same suit for example 4,5,6,7, and 8. The ace can either precede a 2 or follow a king. Payout: 4 tokens. (player wins)</li>
<li><strong>Flush</strong> - Five cards, non necessarily in order, of the same suit. Payout: 5 tokens. (player wins)</li>
<li><strong>Full House</strong> - Three of a kind and a pair, for example three queens and two 5's. Payout: 6 tokens. (player wins)</li>
<li><strong>Four of a Kind</strong> - Four cards of the same rank, such as four queens. Payout: 25 tokens. (player wins)</li>
<li><strong>Straight Flush</strong> - A straight and a flush: Five cards with consecutive ranks all of the same suit. Payout: 50 tokens. (player wins)</li>
<li><strong>Royal Flush</strong> - The best possible hand. A straight flush that begins with rank 10 and ends with ace. Payout: 250 tokens. (player wins)
<br  /> </li>
</ul>
<p><strong>Working Example:</strong> Note: there is a working example of the game installed here on Codio. Just open a terminal and type &ldquo;play&rdquo; to see how your game should work.</p>
<p><strong>How to Complete This Project</strong>
<br  /><em>Your program must use the included templates and follow the instructions provided in the included comments</em>. These templates are for the classes: <code>Card</code>, <code>Deck</code>, <code>Game</code>, <code>Player</code>, and a test class, <code>PokerTest</code>. You will need to fill-in the existing methods and may want to add more methods and/or instance variables to any or all of these classes except for the test class <code>PokerTest</code>. <code>PokerTest</code> must remain exactly as it is here. The hope is that you will use the <code>Card</code> and <code>Deck</code> classes that you implemented for Homework 7 but if you wish to revise those classes for this project you may provided you remain consistent with the scaffolding provided. <strong><em>Remember, never alter any of the provided method signatures and follow the instructions in the comments for all of the included templates.</em></strong></p>
<p>Note that project requires you to have two versions of your game each constructed using a different version of a <code>Game</code> constructor. One will require an explicit parameter that you will get as a command-line argument, this is to help you (and us) test your code. That is, it will allow the user to specify the hand that the player gets which will help in testing if your game correctly identifies the various hands. Carefully read the comments in the template files to help you understand how this will work.
<br  /> 
<br  />We will discuss design decisions and more for this project in lecture, so be sure to come to class!
<br  /> 
<br  />Good luck!</p>
<p><strong>What to hand in</strong>:
<br  />Templates for the five source files for this programming project are located on Codio. In addition to the source files  include a text file named <code>readMe.txt</code> with an explanation of how your program works. That is, write in plain English, instructions for using your software, explanations for how and why you chose to design your code the way you did. Also include any external sources and the names of anyone besides the teaching staff helped you with this assignment. Finally, the <code>readMe.txt</code> file is also an opportunity for you to get partial credit when certain requirements of the assignment are not met, so if something does not work, identify it and discuss it here.</p>
<p>Submit these files on Gradescope:</p>
<ul>
<li><code>Card.java</code></li>
<li><code>Deck.java</code></li>
<li><code>Game.java</code></li>
<li><code>Player.java</code></li>
<li><code>PokerTest.java</code></li>
<li><code>readMe.txt</code>.</li>
</ul>
<p><strong>A word about Grading</strong>
<br  />In this assignment 10% of your grade will be based on how well you adhere to the object-oriented design principles we have been learning in class. That means encapsulation and modularization. If you stick to the design framework laid out by the scaffolding <em>and pay attention to the comments there</em> you should be fine. If you have any questions, as always, please come to office hours!</p>
<p><strong>Common Questions:</strong></p>
<ul>
<li><p>The suit order is clubs (1), diamonds (2), hearts (3), and spades (4) (It's alphabetical)</p>
</li>
<li><p>When you implement the <code>compareTo( )</code> method, you must first compare cards by their rank. Check the suit only if the rank is equal.</p>
</li>
<li><p>You should check that the user is betting between 1 and 5 tokens but you you can otherwise assume good user input.</p>
</li>
<li><p>Players should be able to play more than one game in a session and their winnings or losses should carry over.</p>
</li>
<li><p>It is important that you use the approach for encoding cards on the command-line that is described by the comments in the Game class. That is, s1 for ace of spades, s2 for two of spades etc&hellip;</p>
</li>
<li><p>Shuffle the deck after every hand.</p>
</li>
<li><p>The <code>testPlay</code> method only needs to evaluate the hand provided on the command-line. It does not need to play an actual game or allow the user to play again or anything like that.</p>
</li>
<li><p>Do not change the skeleton code. In particular you may be tempted to make checkHand private, but we need it public to work with the autograder.</p>
</li>
<li><p>Users must place a bet before each hand before they seeing their cards.</p>
</li>
<li><p>Straights do not wrap around so J Q K A 2 is invalid, but 10, J, Q, K, A is valid.</p>
</li>
</ul>
</div>